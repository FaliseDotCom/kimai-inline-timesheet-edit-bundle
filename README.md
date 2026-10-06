# Inline timesheet editing for Kimai

Edit your own records directly in [Kimai](https://www.kimai.org/)'s record lists, without
opening the edit dialog. It ships with the
[Kimai app for Home Assistant](https://github.com/FaliseDotCom/ha-kimai/blob/main/kimai/DOCS.md),
but works in any Kimai installation.

## Editing records in the list

On **My times** and **All times**, the user's own records can be edited in place. Clicking
a record turns its shown cells into fields at once: date, start, end, duration, break,
project (a picker grouped by customer, in the project column or, when that is hidden, the
customer column), activity, description, tags (comma-separated) and billable (a checkbox).
The clicked cell's field gets the focus and Tab moves between the fields. Enter, or leaving
the record with Tab or a click elsewhere, saves all changes in one request; Escape cancels;
Kimai then reloads the list. Picking another project refills the activity picker with that
project's activities, and asks for one when the record's activity does not fit.

Times and durations accept the same short forms as the
[short time entries](https://github.com/FaliseDotCom/kimai-short-time-entries-bundle) plugin,
such as `945` for 9:45 and `90` for an hour and a half, and every format Kimai itself reads.

Only records the user owns and may edit are offered, and only the fields Kimai's tracking
mode and permissions allow (billable needs `edit_billable`, new tags need `create_tag`).
Clicking a record never opens Kimai's edit dialog while this is on, also not for other
users' records; **Edit** in the actions menu still does. Every change goes through
`TimesheetService`, so Kimai's validation, rounding and rate calculation apply, and a
refusal is shown with Kimai's own message.

Each user can turn this off with the **Edit records directly in the list** preference
(`inline_edit_enabled`, on by default).

## New projects and activities

A **+** button next to the project picker adds a project from just its name and its customer,
an existing one or a new one; a **+** next to the activity picker adds an activity. The new
item is selected straight away. Kimai's defaults apply (a new customer gets the default
country, currency, language and time zone), and everything can be changed later in Kimai's
own forms. A name that already exists is reused instead of creating a duplicate. A new
activity is global, unless the selected project only allows its own activities; then it
belongs to that project.

The buttons need Kimai's `create_project` and `create_activity` permissions; a new customer
also needs `create_customer`. `Service/QuickCreator.php` creates everything through Kimai's
`CustomerService`, `ProjectService` and `ActivityService`, so Kimai's validation and creation
events apply. The quick start bar and inline timesheet editing plugins carry the same class,
differing only in its namespace; change both together.

## How it works

On the `timesheet` and `admin_timesheet` routes, and only when the preference is on,
`inline-edit.js` and `inline-edit.css` are added through Kimai's `ThemeEvent::JAVASCRIPT`
and `ThemeEvent::STYLESHEET`. The script reads the record IDs from the rows' edit links and
removes the `modal-ajax-form` class from the rows, so Kimai's row click handler no longer
opens the edit dialog (the actions menu link keeps its own class). It then asks
`InlineEditController` which records the user owns and may edit (with their raw values and
editable fields) and marks those rows; Kimai's `col_*` column classes tell which field a cell
edits. All changed fields of a row are posted together as `changes[field]`, and
`EntryEditor` applies them in a fixed order (date, times, duration, break, project,
activity, the rest) before validating and saving once; times are sent as 24-hour `HH:MM`,
durations in minutes. After a save the script dispatches `kimai.timesheetUpdate`, Kimai
reloads the list, and `kimai.reloadedContent` marks the new rows.

The parsing of typed times and durations lives in `input-parsing.js`, which the script
imports with its own version query, so a release never mixes old and new files from the
browser cache. The short time entries plugin carries an identical copy; change both together.

## Requirements and installation

Kimai 2.67.0 or later.

1. Download the zip of the latest
   [release](https://github.com/FaliseDotCom/kimai-inline-timesheet-edit-bundle/releases) and
   unzip it into `var/plugins/` in your Kimai installation, so the plugin ends up in
   `var/plugins/InlineTimesheetEditBundle/`.
2. Rebuild Kimai's cache: `bin/console kimai:reload --env=prod`.

There are no database changes.

## Translations

English and Dutch, in `Resources/translations/`: the preference label in the `messages`
domain, the hints and error messages in `inline_timesheet_edit`.

## Source

This plugin is developed in the [Kimai app for Home Assistant](https://github.com/FaliseDotCom/ha-kimai)
repository, in `kimai/bundles/InlineTimesheetEditBundle/`. The
[kimai-inline-timesheet-edit-bundle](https://github.com/FaliseDotCom/kimai-inline-timesheet-edit-bundle)
repository is a read-only mirror of that folder for releases: report issues and send changes
to the app repository.

## License

MIT, see [LICENSE](LICENSE).
