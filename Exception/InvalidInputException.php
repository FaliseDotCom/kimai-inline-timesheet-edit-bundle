<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\Exception;

use RuntimeException;

/**
 * A value typed into the list could not be used. The message is a translation key in the
 * inline_timesheet_edit domain.
 */
final class InvalidInputException extends RuntimeException
{
}
