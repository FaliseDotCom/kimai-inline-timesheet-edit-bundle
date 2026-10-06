<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\Controller;

use App\Controller\AbstractController;
use App\Entity\User;
use App\Validator\ValidationFailedException;
use KimaiPlugin\InlineTimesheetEditBundle\EventSubscriber\PreferenceSubscriber;
use KimaiPlugin\InlineTimesheetEditBundle\Exception\InvalidInputException;
use KimaiPlugin\InlineTimesheetEditBundle\Service\BookingOptions;
use KimaiPlugin\InlineTimesheetEditBundle\Service\EntryDescriber;
use KimaiPlugin\InlineTimesheetEditBundle\Service\EntryEditor;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Reads and saves the user's own records for editing them directly in the list.
 */
#[Route( path: '/inline-timesheet-edit' )]
#[IsGranted( 'IS_AUTHENTICATED_REMEMBERED' )]
final class InlineEditController extends AbstractController
{
  public const CSRF_TOKEN_ID = 'inline_timesheet_edit';
  public const ROUTE_ENTRIES = 'inline_timesheet_edit_entries';
  public const ROUTE_OPTIONS = 'inline_timesheet_edit_options';
  public const ROUTE_SAVE = 'inline_timesheet_edit_save';

  /**
   * Name of the posted array of changed values, by field.
   *
   * @var string
   */
  private const CHANGES_PARAMETER = 'changes';

  /**
   * Translation domain of the error messages.
   *
   * @var string
   */
  public const TRANSLATION_DOMAIN = 'inline_timesheet_edit';

  /**
   * @param EntryDescriber $describer Finds and describes the user's editable records.
   * @param EntryEditor $editor Changes and saves a record.
   * @param BookingOptions $options The projects, activities and tags to pick from.
   * @param TranslatorInterface $translator Translates error messages for the script.
   */
  public function __construct(
    private readonly EntryDescriber $describer,
    private readonly EntryEditor $editor,
    private readonly BookingOptions $options,
    private readonly TranslatorInterface $translator
  )
  {
  }

  /**
   * Describes the records in the list that the user may edit.
   *
   * @param Request $request The request, with comma-separated record IDs in "ids".
   * @return JsonResponse
   */
  #[Route( path: '/entries', name: self::ROUTE_ENTRIES, methods: [ 'GET' ] )]
  public function entries( Request $request ) : JsonResponse
  {
    $user = $this->getEnabledUser();
    $ids = array_map( 'intval', explode( ',', (string) $request->query->get( 'ids' ) ) );

    return new JsonResponse( [ 'entries' => (object) $this->describer->describe( $user, $ids ) ] );
  }

  /**
   * Lists the projects, activities and tags the user can pick.
   *
   * @return JsonResponse
   */
  #[Route( path: '/options', name: self::ROUTE_OPTIONS, methods: [ 'GET' ] )]
  public function options() : JsonResponse
  {
    return new JsonResponse( $this->options->describe( $this->getEnabledUser() ) );
  }

  /**
   * Changes one or more fields of a record and saves it once.
   *
   * @param Request $request The posted changes: _token, timesheet, and the new values in changes[field].
   * @return JsonResponse
   */
  #[Route( path: '/save', name: self::ROUTE_SAVE, methods: [ 'POST' ] )]
  public function save( Request $request ) : JsonResponse
  {
    $user = $this->getEnabledUser();
    $entry = $this->describer->findEditable( $user, $request->request->getInt( 'timesheet' ) );

    if ( $entry === null || !$this->isCsrfTokenValid( self::CSRF_TOKEN_ID, (string) $request->request->get( '_token' ) ) )
    {
      return $this->respondWithError( $this->translate( 'inline_edit.not_editable' ) );
    }

    try
    {
      $this->editor->update( $entry, $user, $this->getChanges( $request ) );
    }
    catch ( InvalidInputException $exception )
    {
      return $this->respondWithError( $this->translate( $exception->getMessage() ) );
    }
    catch ( ValidationFailedException $exception )
    {
      return $this->respondWithError( $this->describeViolations( $exception ) );
    }

    return new JsonResponse( [ 'saved' => true ] );
  }

  /**
   * Returns the posted changes as text values, by field.
   *
   * @param Request $request The request.
   * @return array<string, string>
   */
  private function getChanges( Request $request ) : array
  {
    $changes = [];
    foreach ( $request->request->all( self::CHANGES_PARAMETER ) as $field => $value )
    {
      if ( is_string( $value ) )
      {
        $changes[ (string) $field ] = $value;
      }
    }

    return $changes;
  }

  /**
   * Returns the logged-in user, when they have editing in the list turned on.
   *
   * @return User
   * @throws AccessDeniedException When the user turned editing in the list off.
   */
  private function getEnabledUser() : User
  {
    $user = $this->getUser();
    if ( !PreferenceSubscriber::isEnabled( $user ) )
    {
      throw new AccessDeniedException();
    }

    return $user;
  }

  /**
   * Returns an error message for the script.
   *
   * @param string $message The translated message.
   * @return JsonResponse
   */
  private function respondWithError( string $message ) : JsonResponse
  {
    return new JsonResponse( [ 'message' => $message ], Response::HTTP_UNPROCESSABLE_ENTITY );
  }

  /**
   * Translates an error message key.
   *
   * @param string $key The translation key.
   * @return string
   */
  private function translate( string $key ) : string
  {
    return $this->translator->trans( $key, [], self::TRANSLATION_DOMAIN );
  }

  /**
   * Joins the messages of a failed validation into one line.
   *
   * @param ValidationFailedException $exception The failed validation.
   * @return string
   */
  private function describeViolations( ValidationFailedException $exception ) : string
  {
    $messages = [];
    foreach ( $exception->getViolations() as $violation )
    {
      $messages[] = (string) $violation->getMessage();
    }

    return implode( ' ', $messages );
  }
}
