/**
 * Reads times and durations typed in short form, shared by the form improvements and by
 * editing records in the list:
 *
 * - times: 9 → 9:00, 945 → 9:45, 1330 → 13:30, 9.45 → 9:45, 945p → 9:45 PM
 * - durations: 10 → 0:10, 90 → 1:30, 130 → 1:30, 1045 → 10:45
 */

/**
 * A time typed with a separator: 9:45, 9.45, 9,45, 9h45 or 9 45, optionally with am/pm.
 *
 * @type {RegExp}
 */
const SEPARATED_TIME = /^(\d{1,2})\s*[:.,h ]\s*(\d{2})$/;

/**
 * A time or duration typed as digits only: 9, 09, 945 or 1330.
 *
 * @type {RegExp}
 */
const DIGITS = /^\d{1,4}$/;

/**
 * An am/pm suffix: a, am, a.m., p, pm or p.m.
 *
 * @type {RegExp}
 */
const MERIDIEM = /\s*([ap])\.?\s*m?\.?$/i;

/**
 * A duration in hours and minutes: 1:30.
 *
 * @type {RegExp}
 */
const HOURS_MINUTES = /^(\d+):(\d{1,2})$/;

/**
 * A duration in decimal hours: 1.5 or 1,5.
 *
 * @type {RegExp}
 */
const DECIMAL_HOURS = /^(\d*)[.,](\d+)$/;

/**
 * A duration with units: 1h30m, 1h, 30m or 1h 30.
 *
 * @type {RegExp}
 */
const UNIT_DURATION = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/i;

/**
 * Durations of up to this many digits are minutes; longer ones are hours and minutes.
 *
 * @type {number}
 */
const MINUTE_DIGITS = 2;

/**
 * Minutes per hour.
 *
 * @type {number}
 */
const HOUR = 60;

/**
 * Pads a number to two digits.
 *
 * @param {number} value The number.
 * @returns {string}
 */
export function pad( value )
{
  return String( value ).padStart( 2, '0' );
}

/**
 * Reads a typed time as hours and minutes, or returns null when it is not a time.
 *
 * @param {string} input The typed value.
 * @returns {?{hour: number, minute: number}}
 */
export function parseTime( input )
{
  let text = input.trim();
  let meridiem = '';

  const suffix = MERIDIEM.exec( text );
  if ( suffix !== null && /\d/.test( text.slice( 0, suffix.index ) ) )
  {
    meridiem = suffix[ 1 ].toLowerCase();
    text = text.slice( 0, suffix.index ).trim();
  }

  let hour;
  let minute;
  const separated = SEPARATED_TIME.exec( text );

  if ( separated !== null )
  {
    hour = Number( separated[ 1 ] );
    minute = Number( separated[ 2 ] );
  }
  else if ( DIGITS.test( text ) )
  {
    const hourDigits = text.length <= 2 ? text.length : text.length - 2;
    hour = Number( text.slice( 0, hourDigits ) );
    minute = Number( text.slice( hourDigits ) || '0' );
  }
  else
  {
    return null;
  }

  if ( meridiem !== '' )
  {
    if ( hour < 1 || hour > 12 )
    {
      return null;
    }

    hour = hour % 12 + ( meridiem === 'p' ? 12 : 0 );
  }

  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/**
 * Formats a time as 13:30, or as 1:30 PM on a 12-hour clock.
 *
 * @param {{hour: number, minute: number}} time The time.
 * @param {boolean} twelveHour Whether to use a 12-hour clock.
 * @returns {string}
 */
export function formatTime( time, twelveHour )
{
  if ( !twelveHour )
  {
    return pad( time.hour ) + ':' + pad( time.minute );
  }

  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12;

  return hour + ':' + pad( time.minute ) + ' ' + ( time.hour < 12 ? 'AM' : 'PM' );
}

/**
 * Reads a short duration typed as digits as minutes, or returns null when it is not one.
 *
 * @param {string} text The typed value, trimmed.
 * @returns {?number}
 */
function parseShortDuration( text )
{
  if ( !DIGITS.test( text ) )
  {
    return null;
  }

  const minutes = Number( text );
  if ( text.length <= MINUTE_DIGITS )
  {
    return minutes;
  }

  const hours = Number( text.slice( 0, -2 ) );
  const rest = Number( text.slice( -2 ) );

  return rest < HOUR ? hours * HOUR + rest : minutes;
}

/**
 * Formats minutes as hours and minutes: 1:30.
 *
 * @param {number} minutes The duration in minutes.
 * @returns {string}
 */
export function formatDuration( minutes )
{
  return Math.floor( minutes / HOUR ) + ':' + pad( minutes % HOUR );
}

/**
 * Expands a short duration to hours and minutes, or returns null when it is not one.
 *
 * @param {string} input The typed value.
 * @returns {?string}
 */
export function expandDuration( input )
{
  const minutes = parseShortDuration( input.trim() );

  return minutes === null ? null : formatDuration( minutes );
}

/**
 * Reads any duration Kimai accepts as minutes: the short forms, 1:30, 1.5 and 1h30m. Returns
 * null when it is not a duration.
 *
 * @param {string} input The typed value.
 * @returns {?number}
 */
export function parseDuration( input )
{
  const text = input.trim();
  const short = parseShortDuration( text );
  if ( short !== null )
  {
    return short;
  }

  const separated = HOURS_MINUTES.exec( text );
  if ( separated !== null )
  {
    return Number( separated[ 1 ] ) * HOUR + Number( separated[ 2 ] );
  }

  const decimal = DECIMAL_HOURS.exec( text );
  if ( decimal !== null )
  {
    return Math.round( Number( ( decimal[ 1 ] || '0' ) + '.' + decimal[ 2 ] ) * HOUR );
  }

  const units = UNIT_DURATION.exec( text );
  if ( text !== '' && units !== null && ( units[ 1 ] !== undefined || units[ 2 ] !== undefined ) )
  {
    return Number( units[ 1 ] ?? 0 ) * HOUR + Number( units[ 2 ] ?? 0 );
  }

  return null;
}
