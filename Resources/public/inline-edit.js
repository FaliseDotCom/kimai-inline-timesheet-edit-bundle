/**
 * Edit the user's own records directly in Kimai's record lists: click a record to turn its
 * cells into fields, Tab between them, and press Enter or leave the record to save all
 * changes at once; Escape cancels. After a save Kimai reloads the list, so totals stay right.
 * Clicking a record no longer opens Kimai's edit dialog; Actions > Edit still does.
 */

// Loaded with this script's version query, so a release never mixes cached files.
const { parseTime, formatTime, parseDuration, formatDuration } = await import( new URL( 'input-parsing.js' + new URL( import.meta.url ).search, import.meta.url ).href );

/**
 * The script tag, which carries the endpoint addresses, the token and the messages.
 *
 * @type {?HTMLScriptElement}
 */
const SCRIPT = [ ...document.scripts ].find( ( script ) => script.src === import.meta.url ) ?? null;

/**
 * Selector of the record rows; Kimai links each row the user may edit to its edit page.
 *
 * @type {string}
 */
const ROW_SELECTOR = 'tr[data-href]';

/**
 * Extracts the record ID from a row's edit link, on "My times" and on "All times".
 *
 * @type {RegExp}
 */
const ENTRY_ID_PATTERN = /\/timesheet\/(\d+)\/edit/;

/**
 * Classes that make Kimai open the edit dialog when a row is clicked.
 *
 * @type {Array<string>}
 */
const KIMAI_DIALOG_CLASSES = [ 'modal-ajax-form', 'open-edit' ];

/**
 * Cells whose clicks belong to Kimai: the selection checkbox and the actions menu.
 *
 * @type {string}
 */
const KIMAI_CELLS = 'td.multiCheckbox, td.actions';

/**
 * The field each list column edits, by the column class Kimai gives its cells. The customer
 * column picks the project, which decides the customer.
 *
 * @type {Object<string, string>}
 */
const COLUMN_FIELDS = {
  col_date: 'date',
  col_starttime: 'begin',
  col_endtime: 'end',
  col_duration: 'duration',
  col_break: 'break',
  col_customer: 'project',
  col_project: 'project',
  col_activity: 'activity',
  col_description: 'description',
  col_tags: 'tags',
  col_billable: 'billable',
};

/**
 * Column that holds the project picker when it is shown; otherwise the customer column does.
 *
 * @type {string}
 */
const PROJECT_COLUMN = 'col_project';

/**
 * Class of rows that can be edited.
 *
 * @type {string}
 */
const EDITABLE_CLASS = 'inline-edit-row';

/**
 * Class of the row being edited.
 *
 * @type {string}
 */
const EDITING_CLASS = 'inline-edit-editing';

/**
 * Class of a row whose changes are being saved.
 *
 * @type {string}
 */
const SAVING_CLASS = 'inline-edit-saving';

/**
 * Class of the editor fields.
 *
 * @type {string}
 */
const FIELD_CLASS = 'form-control form-control-sm inline-edit-field';

/**
 * Class of the editor pickers.
 *
 * @type {string}
 */
const SELECT_CLASS = 'form-select form-select-sm inline-edit-field';

/**
 * Class of the billable checkbox.
 *
 * @type {string}
 */
const CHECKBOX_CLASS = 'form-check-input inline-edit-field';

/**
 * Bootstrap class that marks a field with an invalid value.
 *
 * @type {string}
 */
const INVALID_CLASS = 'is-invalid';

/**
 * Elements that take clicks and focus themselves inside a row being edited.
 *
 * @type {string}
 */
const FOCUSABLE = 'input, select, textarea, button, a, label';

/**
 * Class of the small "+" forms that create a project or an activity.
 *
 * @type {string}
 */
const CREATE_MENU_CLASS = 'inline-edit-create-menu';

/**
 * Class that puts a picker and its "+" button side by side.
 *
 * @type {string}
 */
const PICKER_CLASS = 'inline-edit-picker';

/**
 * Event Kimai dispatches after it reloaded the list.
 *
 * @type {string}
 */
const KIMAI_RELOADED_EVENT = 'kimai.reloadedContent';

/**
 * Event that makes Kimai reload the list after a record changed.
 *
 * @type {string}
 */
const KIMAI_UPDATE_EVENT = 'kimai.timesheetUpdate';

/**
 * Detects a 12-hour clock in a cell's text.
 *
 * @type {RegExp}
 */
const TWELVE_HOUR_PATTERN = /[ap]\.?m\.?/i;

/**
 * Separator of tag names in the tag field.
 *
 * @type {string}
 */
const TAG_SEPARATOR = ', ';

/**
 * Activity project ID that marks a global activity.
 *
 * @type {number}
 */
const GLOBAL_ACTIVITY = 0;

/**
 * Settings from the script tag.
 *
 * @type {{entriesUrl: string, optionsUrl: string, saveUrl: string, createProjectUrl: string, createActivityUrl: string, token: string, messages: Object<string, string>}}
 */
const CONFIG = {
  entriesUrl: SCRIPT?.dataset.entriesUrl ?? '',
  optionsUrl: SCRIPT?.dataset.optionsUrl ?? '',
  saveUrl: SCRIPT?.dataset.saveUrl ?? '',
  createProjectUrl: SCRIPT?.dataset.createProjectUrl ?? '',
  createActivityUrl: SCRIPT?.dataset.createActivityUrl ?? '',
  token: SCRIPT?.dataset.token ?? '',
  messages: JSON.parse( SCRIPT?.dataset.messages ?? '{}' ),
};

/**
 * One field of the row being edited.
 *
 * @typedef {{field: string, cell: HTMLTableCellElement, editor: HTMLElement, original: Array<Node>}} RowField
 */

/**
 * The row being edited.
 *
 * @typedef {{row: HTMLTableRowElement, entry: Object, fields: Array<RowField>, saving: boolean}} RowEdit
 */

/**
 * The editable records in the list, by ID, with their raw values and editable fields.
 *
 * @type {Object<string, Object>}
 */
let entries = {};

/**
 * The projects, activities and tags to pick from, loaded when first needed.
 *
 * @type {?Promise<Object>}
 */
let optionsRequest = null;

/**
 * The row being edited, or null.
 *
 * @type {?RowEdit}
 */
let editing = null;

/**
 * A record clicked while another one was being saved, opened once the list has reloaded.
 *
 * @type {?{id: string, column: string}}
 */
let pendingOpen = null;

/**
 * Fetches JSON from the plugin.
 *
 * @param {string} url The address.
 * @param {RequestInit} init Request settings.
 * @returns {Promise<Object>}
 */
async function fetchJson( url, init = {} )
{
  const response = await fetch( url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, ...init } );
  const data = await response.json().catch( () => ( {} ) );

  if ( !response.ok )
  {
    throw new Error( data.message ?? CONFIG.messages.saveFailed );
  }

  return data;
}

/**
 * Returns the projects, activities and tags, loading them once.
 *
 * @returns {Promise<Object>}
 */
function loadOptions()
{
  optionsRequest ??= fetchJson( CONFIG.optionsUrl ).catch( ( error ) =>
  {
    optionsRequest = null;
    throw error;
  } );

  return optionsRequest;
}

/**
 * Shows an error the way Kimai shows its own.
 *
 * @param {string} message The message.
 * @returns {void}
 */
function showError( message )
{
  const alert = window.kimai?.getPlugin( 'alert' );
  if ( alert )
  {
    alert.error( message );
    return;
  }

  window.alert( message );
}

/**
 * Returns the record ID of a row, or an empty string.
 *
 * @param {HTMLTableRowElement} row The row.
 * @returns {string}
 */
function getEntryId( row )
{
  return ENTRY_ID_PATTERN.exec( row.dataset.href ?? '' )?.[ 1 ] ?? '';
}

/**
 * Returns the list column of a cell, or an empty string.
 *
 * @param {HTMLTableCellElement} cell The cell.
 * @returns {string}
 */
function getCellColumn( cell )
{
  return [ ...cell.classList ].find( ( name ) => Object.hasOwn( COLUMN_FIELDS, name ) ) ?? '';
}

/**
 * Tells whether a cell is shown; Kimai hides columns on small screens and by preference.
 *
 * @param {HTMLTableCellElement} cell The cell.
 * @returns {boolean}
 */
function isShown( cell )
{
  return cell.getClientRects().length > 0;
}

/**
 * Keeps Kimai from opening the edit dialog on row clicks, loads the editable records in the
 * list and marks their rows.
 *
 * @returns {Promise<void>}
 */
async function markRows()
{
  if ( editing !== null && !editing.row.isConnected )
  {
    editing = null;
  }

  const rows = [ ...document.querySelectorAll( ROW_SELECTOR ) ].filter( ( row ) => getEntryId( row ) !== '' );
  rows.forEach( ( row ) => row.classList.remove( ...KIMAI_DIALOG_CLASSES ) );
  if ( rows.length === 0 )
  {
    return;
  }

  try
  {
    entries = ( await fetchJson( CONFIG.entriesUrl + '?ids=' + rows.map( getEntryId ).join( ',' ) ) ).entries ?? {};
  }
  catch
  {
    return;
  }

  rows.forEach( ( row ) =>
  {
    const id = getEntryId( row );
    if ( entries[ id ] === undefined )
    {
      return;
    }

    row.dataset.inlineEntry = id;
    row.classList.add( EDITABLE_CLASS );
    row.title = CONFIG.messages.hint;
  } );

  openPending();
}

/**
 * Opens the record that was clicked while another one was being saved.
 *
 * @returns {void}
 */
function openPending()
{
  const pending = pendingOpen;
  pendingOpen = null;

  const row = pending === null ? null : document.querySelector( 'tr[data-inline-entry="' + pending.id + '"]' );
  if ( row !== null )
  {
    openRow( row, row.querySelector( 'td.' + pending.column ) );
  }
}

/**
 * Creates a text field.
 *
 * @param {string} value The current value.
 * @param {string} placeholder The placeholder.
 * @returns {HTMLInputElement}
 */
function createInput( value, placeholder = '' )
{
  const input = document.createElement( 'input' );
  input.type = 'text';
  input.className = FIELD_CLASS;
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';

  return input;
}

/**
 * Creates a picker with the given options, grouped when groups are given.
 *
 * @param {Array<{label: string, options: Array<{value: string, label: string}>}>} groups Option groups; an empty label means no group.
 * @param {string} selected The selected value.
 * @param {string} placeholder Text of an empty first option, or an empty string for none.
 * @returns {HTMLSelectElement}
 */
function createSelect( groups, selected, placeholder = '' )
{
  const select = document.createElement( 'select' );
  select.className = SELECT_CLASS;

  if ( placeholder !== '' )
  {
    select.append( new Option( placeholder, '' ) );
  }

  groups.forEach( ( group ) =>
  {
    const parent = group.label === '' ? select : document.createElement( 'optgroup' );
    parent.label = group.label;
    group.options.forEach( ( option ) => parent.append( new Option( option.label, option.value ) ) );

    if ( parent !== select )
    {
      select.append( parent );
    }
  } );

  select.value = selected;

  return select;
}

/**
 * Returns the activities that can be booked on a project.
 *
 * @param {Object} options The loaded options.
 * @param {number} projectId The project ID.
 * @returns {Array<Object>}
 */
function getProjectActivities( options, projectId )
{
  const project = options.customers.flatMap( ( customer ) => customer.projects ).find( ( item ) => item.id === projectId );

  return options.activities.filter( ( activity ) => activity.projectId === projectId || ( activity.projectId === GLOBAL_ACTIVITY && project?.globalActivities ) );
}

/**
 * Creates the activity picker for a project. When the selected activity does not fit the
 * project, an empty "choose an activity" option is selected instead.
 *
 * @param {Object} options The loaded options.
 * @param {number} projectId The project ID.
 * @param {Object} entry The record.
 * @param {string} selected The selected activity ID.
 * @returns {HTMLSelectElement}
 */
function createActivitySelect( options, projectId, entry, selected )
{
  const activities = getProjectActivities( options, projectId ).map( ( activity ) => ( { value: String( activity.id ), label: activity.name } ) );
  if ( projectId === entry.projectId && !activities.some( ( activity ) => activity.value === String( entry.activityId ) ) )
  {
    activities.unshift( { value: String( entry.activityId ), label: entry.activityName } );
  }

  const fits = activities.some( ( activity ) => activity.value === selected );

  return createSelect( [ { label: '', options: activities } ], fits ? selected : '', fits ? '' : CONFIG.messages.chooseActivity );
}

/**
 * Creates the project picker, grouped by customer.
 *
 * @param {Object} options The loaded options.
 * @param {Object} entry The record.
 * @returns {HTMLSelectElement}
 */
function createProjectSelect( options, entry )
{
  const groups = options.customers.map( ( customer ) => ( {
    label: customer.name,
    options: customer.projects.map( ( project ) => ( { value: String( project.id ), label: project.name } ) ),
  } ) );

  if ( !groups.some( ( group ) => group.options.some( ( option ) => option.value === String( entry.projectId ) ) ) )
  {
    groups.unshift( { label: '', options: [ { value: String( entry.projectId ), label: entry.projectName } ] } );
  }

  return createSelect( groups, String( entry.projectId ) );
}

/**
 * Creates the billable checkbox.
 *
 * @param {Object} entry The record.
 * @returns {HTMLInputElement}
 */
function createCheckbox( entry )
{
  const checkbox = document.createElement( 'input' );
  checkbox.type = 'checkbox';
  checkbox.className = CHECKBOX_CLASS;
  checkbox.checked = entry.billable;

  return checkbox;
}

/**
 * Creates the editor for a text-like field, filled with the current value.
 *
 * @param {string} field The field.
 * @param {Object} entry The record.
 * @param {HTMLTableCellElement} cell The cell, whose text tells the clock format.
 * @returns {HTMLInputElement|HTMLTextAreaElement}
 */
function createTextEditor( field, entry, cell )
{
  if ( field === 'date' )
  {
    const input = createInput( entry.date );
    input.type = 'date';

    return input;
  }

  if ( field === 'begin' || field === 'end' )
  {
    const time = parseTime( entry[ field ] );

    return createInput( time === null ? '' : formatTime( time, TWELVE_HOUR_PATTERN.test( cell.textContent ) ) );
  }

  if ( field === 'duration' || field === 'break' )
  {
    return createInput( formatDuration( entry[ field ] ) );
  }

  if ( field === 'tags' )
  {
    return createInput( entry.tags.join( TAG_SEPARATOR ), CONFIG.messages.tagsPlaceholder );
  }

  const textarea = document.createElement( 'textarea' );
  textarea.className = FIELD_CLASS;
  textarea.rows = 2;
  textarea.value = entry.description;

  return textarea;
}

/**
 * Creates the editor of a field.
 *
 * @param {string} field The field.
 * @param {Object} entry The record.
 * @param {HTMLTableCellElement} cell The cell.
 * @param {?Object} options The loaded options; needed for the project and activity.
 * @returns {HTMLElement}
 */
function createEditor( field, entry, cell, options )
{
  if ( field === 'billable' )
  {
    return createCheckbox( entry );
  }

  if ( field === 'project' )
  {
    return createProjectSelect( options, entry );
  }

  if ( field === 'activity' )
  {
    return createActivitySelect( options, entry.projectId, entry, String( entry.activityId ) );
  }

  return createTextEditor( field, entry, cell );
}

/**
 * Returns the shown cells of a row that edit a field of the record, by field. The project is
 * edited in the project column, or in the customer column when the project column is hidden.
 *
 * @param {HTMLTableRowElement} row The row.
 * @param {Object} entry The record.
 * @returns {Array<{field: string, cell: HTMLTableCellElement}>}
 */
function getEditableCells( row, entry )
{
  const cells = [ ...row.cells ].filter( isShown );
  const projectInOwnColumn = cells.some( ( cell ) => getCellColumn( cell ) === PROJECT_COLUMN );

  return cells
    .map( ( cell ) => ( { field: COLUMN_FIELDS[ getCellColumn( cell ) ] ?? '', cell, column: getCellColumn( cell ) } ) )
    .filter( ( item ) => entry.fields.includes( item.field ) )
    .filter( ( item ) => item.field !== 'project' || projectInOwnColumn === ( item.column === PROJECT_COLUMN ) )
    .map( ( { field, cell } ) => ( { field, cell } ) );
}

/**
 * Turns the cells of a record into fields and focuses the one in the clicked cell.
 *
 * @param {HTMLTableRowElement} row The row.
 * @param {?HTMLTableCellElement} focusCell The clicked cell.
 * @returns {Promise<void>}
 */
async function openRow( row, focusCell )
{
  const entry = entries[ row.dataset.inlineEntry ];
  const cells = getEditableCells( row, entry );
  if ( cells.length === 0 )
  {
    return;
  }

  let options = null;
  if ( cells.some( ( item ) => item.field === 'project' || item.field === 'activity' ) )
  {
    row.classList.add( SAVING_CLASS );
    try
    {
      options = await loadOptions();
    }
    catch ( error )
    {
      showError( error.message );
      return;
    }
    finally
    {
      row.classList.remove( SAVING_CLASS );
    }
  }

  if ( editing !== null || !row.isConnected )
  {
    return;
  }

  const fields = cells.map( ( { field, cell } ) => ( { field, cell, editor: createEditor( field, entry, cell, options ), original: [ ...cell.childNodes ] } ) );
  fields.forEach( ( item ) => item.cell.replaceChildren( wrapEditor( item, fields, entry, options ) ) );
  row.classList.add( EDITING_CLASS );
  row.title = '';
  editing = { row, entry, fields, saving: false };

  linkProjectToActivity( fields, entry, options );
  focusField( ( fields.find( ( item ) => item.cell === focusCell ) ?? fields[ 0 ] ).editor );
}

/**
 * Returns what goes into a cell: the editor, with a "+" button next to the project and
 * activity pickers when the user may create those.
 *
 * @param {RowField} item The field.
 * @param {Array<RowField>} fields All fields of the row.
 * @param {Object} entry The record.
 * @param {?Object} options The loaded options.
 * @returns {HTMLElement}
 */
function wrapEditor( item, fields, entry, options )
{
  if ( ( item.field !== 'project' && item.field !== 'activity' ) || !options?.quickCreate?.[ item.field ] )
  {
    return item.editor;
  }

  const wrapper = document.createElement( 'div' );
  wrapper.className = PICKER_CLASS;
  wrapper.append( item.editor, createQuickCreate( item.field, fields, entry, options ) );

  return wrapper;
}

/**
 * Creates a text field for the "+" form.
 *
 * @param {string} placeholder The placeholder, also its label.
 * @returns {HTMLInputElement}
 */
function createMenuInput( placeholder )
{
  const input = createInput( '', placeholder );
  input.maxLength = 150;
  input.setAttribute( 'aria-label', placeholder );

  return input;
}

/**
 * Creates the "+" button with its small form for a new project (and customer) or activity.
 *
 * @param {string} type Either "project" or "activity".
 * @param {Array<RowField>} fields The fields of the row.
 * @param {Object} entry The record.
 * @param {Object} options The loaded options, which the new item is added to.
 * @returns {HTMLElement}
 */
function createQuickCreate( type, fields, entry, options )
{
  const label = type === 'project' ? CONFIG.messages.newProject : CONFIG.messages.newActivity;
  const dropdown = document.createElement( 'div' );
  dropdown.className = 'dropdown';

  const toggle = document.createElement( 'button' );
  toggle.type = 'button';
  toggle.className = 'btn btn-sm btn-icon';
  toggle.title = label;
  toggle.setAttribute( 'aria-label', label );
  toggle.setAttribute( 'aria-expanded', 'false' );
  toggle.dataset.bsToggle = 'dropdown';
  toggle.dataset.bsAutoClose = 'outside';
  toggle.innerHTML = '<i class="fas fa-plus"></i>';

  const menu = document.createElement( 'div' );
  menu.className = 'dropdown-menu dropdown-menu-end ' + CREATE_MENU_CLASS;

  const name = createMenuInput( type === 'project' ? CONFIG.messages.projectName : CONFIG.messages.activityName );
  const customer = type === 'project' ? createMenuInput( CONFIG.messages.customerName ) : null;
  const submit = document.createElement( 'button' );
  submit.type = 'button';
  submit.className = 'btn btn-primary btn-sm';
  submit.textContent = CONFIG.messages.add;

  menu.append( ...[ name, customer, submit ].filter( Boolean ) );
  if ( customer !== null )
  {
    const list = document.createElement( 'datalist' );
    list.id = 'inline-edit-customers-' + entry.projectId + '-' + Date.now();
    options.quickCreate.customers.forEach( ( customerName ) => list.append( new Option( customerName ) ) );
    customer.setAttribute( 'list', list.id );
    menu.append( list );
  }

  const create = async () =>
  {
    const project = fields.find( ( item ) => item.field === 'project' )?.editor;
    const body = new FormData();
    body.append( '_token', CONFIG.token );
    body.append( 'name', name.value );
    body.append( 'customer', customer?.value ?? '' );
    body.append( 'project', project?.value ?? String( entry.projectId ) );

    let created;
    try
    {
      created = await fetchJson( type === 'project' ? CONFIG.createProjectUrl : CONFIG.createActivityUrl, { method: 'POST', body } );
    }
    catch ( error )
    {
      showError( error.message );
      return;
    }

    if ( type === 'project' )
    {
      addCreatedProject( created, fields, options );
    }
    else
    {
      addCreatedActivity( created, fields, entry, options );
    }

    [ name, customer ].forEach( ( input ) => { if ( input !== null ) { input.value = ''; } } );
    toggle.click();
    fields.find( ( item ) => item.field === type )?.editor.focus();
  };

  submit.addEventListener( 'click', create );
  menu.addEventListener( 'keydown', ( event ) =>
  {
    if ( event.key === 'Enter' )
    {
      event.preventDefault();
      create();
    }
  } );
  dropdown.addEventListener( 'shown.bs.dropdown', () => name.focus() );
  dropdown.append( toggle, menu );

  return dropdown;
}

/**
 * Adds a created project to the loaded options and the project picker, and selects it.
 *
 * @param {{id: number, name: string, customer: string, globalActivities: boolean}} project The new project.
 * @param {Array<RowField>} fields The fields of the row.
 * @param {Object} options The loaded options.
 * @returns {void}
 */
function addCreatedProject( project, fields, options )
{
  let group = options.customers.find( ( item ) => item.name === project.customer );
  if ( group === undefined )
  {
    group = { name: project.customer, projects: [] };
    options.customers.push( group );
  }

  if ( !group.projects.some( ( item ) => item.id === project.id ) )
  {
    group.projects.push( { id: project.id, name: project.name, globalActivities: project.globalActivities } );
  }

  const select = fields.find( ( item ) => item.field === 'project' ).editor;
  if ( select.querySelector( 'option[value="' + project.id + '"]' ) === null )
  {
    let optgroup = [ ...select.querySelectorAll( 'optgroup' ) ].find( ( item ) => item.label === project.customer );
    if ( optgroup === undefined )
    {
      optgroup = document.createElement( 'optgroup' );
      optgroup.label = project.customer;
      select.append( optgroup );
    }

    optgroup.append( new Option( project.name, String( project.id ) ) );
  }

  select.value = String( project.id );
  // Refills the activity picker for the new project.
  select.dispatchEvent( new Event( 'change' ) );
}

/**
 * Adds a created activity to the loaded options and the activity picker, and selects it.
 *
 * @param {{id: number, name: string, projectId: number}} activity The new activity.
 * @param {Array<RowField>} fields The fields of the row.
 * @param {Object} entry The record.
 * @param {Object} options The loaded options.
 * @returns {void}
 */
function addCreatedActivity( activity, fields, entry, options )
{
  if ( !options.activities.some( ( item ) => item.id === activity.id ) )
  {
    options.activities.push( activity );
  }

  const project = fields.find( ( item ) => item.field === 'project' )?.editor;
  const select = fields.find( ( item ) => item.field === 'activity' ).editor;
  const fresh = createActivitySelect( options, Number( project?.value ?? entry.projectId ), entry, String( activity.id ) );
  const value = fresh.value;

  select.replaceChildren( ...fresh.children );
  select.value = value;
}

/**
 * Refills the activity picker when another project is picked, so it only offers activities
 * of that project.
 *
 * @param {Array<RowField>} fields The fields of the row.
 * @param {Object} entry The record.
 * @param {?Object} options The loaded options.
 * @returns {void}
 */
function linkProjectToActivity( fields, entry, options )
{
  const project = fields.find( ( item ) => item.field === 'project' )?.editor;
  const activity = fields.find( ( item ) => item.field === 'activity' )?.editor;
  if ( project === undefined || activity === undefined )
  {
    return;
  }

  project.addEventListener( 'change', () =>
  {
    const fresh = createActivitySelect( options, Number( project.value ), entry, activity.value );
    const value = fresh.value;
    activity.replaceChildren( ...fresh.children );
    activity.value = value;
  } );
}

/**
 * Focuses a field and selects its text, so typing replaces the value.
 *
 * @param {HTMLElement} editor The field.
 * @returns {void}
 */
function focusField( editor )
{
  editor.focus();
  if ( editor instanceof HTMLInputElement && editor.type === 'text' )
  {
    editor.select();
  }
}

/**
 * Puts the original cell contents back and ends editing.
 *
 * @returns {void}
 */
function closeRow()
{
  if ( editing === null )
  {
    return;
  }

  // Cleared first: removing the focused field fires a focusout, which must not save.
  const current = editing;
  editing = null;

  current.fields.forEach( ( item ) => item.cell.replaceChildren( ...item.original ) );
  current.row.classList.remove( EDITING_CLASS, SAVING_CLASS );
  current.row.title = CONFIG.messages.hint;
}

/**
 * Reads the value to save from a typed field, or returns null when it is not valid.
 *
 * @param {string} field The field.
 * @param {string} text The typed text.
 * @param {Object} entry The record; a running record keeps an empty end.
 * @returns {?string}
 */
function readTypedValue( field, text, entry )
{
  if ( field === 'date' )
  {
    return text === '' ? null : text;
  }

  if ( field === 'begin' || field === 'end' )
  {
    if ( text.trim() === '' && entry[ field ] === '' )
    {
      return '';
    }

    const time = parseTime( text );

    return time === null ? null : formatTime( time, false );
  }

  if ( field === 'duration' || field === 'break' )
  {
    const minutes = text.trim() === '' && field === 'break' ? 0 : parseDuration( text );

    return minutes === null ? null : String( minutes );
  }

  return field === 'tags' ? text.split( ',' ).map( ( name ) => name.trim() ).filter( Boolean ).join( ',' ) : text.trim();
}

/**
 * Reads the value to save from a field, or returns null when it is not valid.
 *
 * @param {RowField} item The field.
 * @param {Object} entry The record.
 * @returns {?string}
 */
function readValue( item, entry )
{
  if ( item.field === 'billable' )
  {
    return item.editor.checked ? '1' : '0';
  }

  if ( item.field === 'project' || item.field === 'activity' )
  {
    return item.editor.value === '' ? null : item.editor.value;
  }

  return readTypedValue( item.field, item.editor.value, entry );
}

/**
 * Returns the current value of a field in the form the server expects.
 *
 * @param {string} field The field.
 * @param {Object} entry The record.
 * @returns {string}
 */
function getCurrentValue( field, entry )
{
  const values = {
    duration: String( entry.duration ),
    break: String( entry.break ),
    tags: entry.tags.join( ',' ),
    billable: entry.billable ? '1' : '0',
    project: String( entry.projectId ),
    activity: String( entry.activityId ),
  };

  return values[ field ] ?? String( entry[ field ] ?? '' );
}

/**
 * Returns the message of a field with a value that cannot be read.
 *
 * @param {string} field The field.
 * @returns {string}
 */
function getInvalidMessage( field )
{
  const messages = {
    date: CONFIG.messages.invalidDate,
    begin: CONFIG.messages.invalidTime,
    end: CONFIG.messages.invalidTime,
    activity: CONFIG.messages.chooseActivity,
  };

  return messages[ field ] ?? CONFIG.messages.invalidDuration;
}

/**
 * Collects the changed values of the row being edited. Fields that cannot be read are
 * marked; null is returned when there are any.
 *
 * @returns {?Object<string, string>}
 */
function collectChanges()
{
  const changes = {};
  const invalid = [];

  editing.fields.forEach( ( item ) =>
  {
    const value = readValue( item, editing.entry );
    item.editor.classList.toggle( INVALID_CLASS, value === null );
    item.editor.title = value === null ? getInvalidMessage( item.field ) : '';

    if ( value === null )
    {
      invalid.push( item );
    }
    else if ( value !== getCurrentValue( item.field, editing.entry ) )
    {
      changes[ item.field ] = value;
    }
  } );

  // A new project is saved with the picked activity, which may have to change with it.
  const activity = editing.fields.find( ( item ) => item.field === 'activity' );
  if ( changes.project !== undefined && activity !== undefined && activity.editor.value !== '' )
  {
    changes.activity = activity.editor.value;
  }

  return invalid.length === 0 ? changes : null;
}

/**
 * Saves the changes of the row being edited, and lets Kimai reload the list. Fields with a
 * value that cannot be read are marked and keep the row open.
 *
 * @param {boolean} leaving Whether the focus left the row; then nothing is focused.
 * @returns {Promise<void>}
 */
async function commitRow( leaving )
{
  if ( editing === null || editing.saving )
  {
    return;
  }

  const changes = collectChanges();
  if ( changes === null )
  {
    if ( !leaving )
    {
      focusField( editing.fields.find( ( item ) => item.editor.classList.contains( INVALID_CLASS ) ).editor );
    }
    return;
  }

  if ( Object.keys( changes ).length === 0 )
  {
    closeRow();
    return;
  }

  const body = new FormData();
  body.append( '_token', CONFIG.token );
  body.append( 'timesheet', editing.row.dataset.inlineEntry );
  Object.entries( changes ).forEach( ( [ field, value ] ) => body.append( 'changes[' + field + ']', value ) );

  const current = editing;
  current.saving = true;
  current.row.classList.add( SAVING_CLASS );
  try
  {
    await fetchJson( CONFIG.saveUrl, { method: 'POST', body } );
  }
  catch ( error )
  {
    current.saving = false;
    current.row.classList.remove( SAVING_CLASS );
    pendingOpen = null;
    showError( error.message );
    focusField( current.fields[ 0 ].editor );

    return;
  }

  // The row stays until Kimai's reload replaces it; markRows() then ends the editing.
  document.dispatchEvent( new Event( KIMAI_UPDATE_EVENT ) );
}

// Capture phase: decides about the click before Kimai's own row handling.
document.addEventListener( 'click', ( event ) =>
{
  const target = event.target instanceof Element ? event.target : null;
  const row = target?.closest( 'tr.' + EDITABLE_CLASS ) ?? null;
  if ( row === null || target.closest( KIMAI_CELLS ) !== null || row === editing?.row )
  {
    return;
  }

  if ( event.ctrlKey || event.metaKey || event.shiftKey || window.getSelection()?.toString() !== '' )
  {
    return;
  }

  const cell = target.closest( 'td' );
  if ( editing?.saving )
  {
    pendingOpen = { id: row.dataset.inlineEntry, column: cell === null ? '' : getCellColumn( cell ) };
    return;
  }

  if ( editing === null )
  {
    openRow( row, cell );
  }
}, true );

// Clicks on the empty parts of the row being edited keep the focus in its field.
document.addEventListener( 'mousedown', ( event ) =>
{
  const target = event.target instanceof Element ? event.target : null;
  if ( editing !== null && target !== null && editing.row.contains( target ) && target.closest( FOCUSABLE ) === null )
  {
    event.preventDefault();
  }
}, true );

document.addEventListener( 'keydown', ( event ) =>
{
  // The "+" forms handle their own Enter, and Escape closes them, not the record.
  if ( editing === null || !editing.row.contains( event.target ) || event.target.closest( '.' + CREATE_MENU_CLASS ) !== null )
  {
    return;
  }

  if ( event.key === 'Escape' )
  {
    event.preventDefault();
    closeRow();
  }
  else if ( event.key === 'Enter' && !( event.shiftKey && event.target instanceof HTMLTextAreaElement ) )
  {
    event.preventDefault();
    commitRow( false );
  }
}, true );

// Leaving the record, with Tab past its last field or by clicking elsewhere, saves it.
// Switching to another window, for example to take a screenshot, keeps it open: the check
// waits until the focus has settled and skips it when the page itself lost the focus.
document.addEventListener( 'focusout', ( event ) =>
{
  if ( editing === null || !editing.row.contains( event.target ) || editing.row.contains( event.relatedTarget ) )
  {
    return;
  }

  setTimeout( () =>
  {
    if ( editing !== null && document.hasFocus() && !editing.row.contains( document.activeElement ) )
    {
      commitRow( true );
    }
  }, 0 );
} );

document.addEventListener( KIMAI_RELOADED_EVENT, markRows );

if ( document.readyState === 'loading' )
{
  document.addEventListener( 'DOMContentLoaded', markRows );
}
else
{
  markRows();
}
