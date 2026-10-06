<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\EventSubscriber;

use App\Entity\User;
use App\Event\ThemeEvent;
use KimaiPlugin\InlineTimesheetEditBundle\Controller\AssetController;
use KimaiPlugin\InlineTimesheetEditBundle\Controller\InlineEditController;
use KimaiPlugin\InlineTimesheetEditBundle\InlineTimesheetEditBundle;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Adds the inline edit script and stylesheet to the record lists when the user has inline
 * editing turned on.
 */
final class ScriptSubscriber implements EventSubscriberInterface
{
  /**
   * The script that edits records in the list.
   *
   * @var string
   */
  private const INLINE_EDIT_SCRIPT = 'inline-edit.js';

  /**
   * The stylesheet of editing records in the list.
   *
   * @var string
   */
  private const INLINE_EDIT_STYLESHEET = 'inline-edit.css';

  /**
   * The record lists: "My times" and "All times", with their paginated variants.
   *
   * @var array<int, string>
   */
  private const LIST_ROUTES = [ 'timesheet', 'timesheet_paginated', 'admin_timesheet', 'admin_timesheet_paginated' ];

  /**
   * Messages the inline edit script shows, by the key it uses.
   *
   * @var array<string, string>
   */
  private const MESSAGES = [
    'hint' => 'inline_edit.hint',
    'invalidDate' => 'inline_edit.invalid_date',
    'invalidTime' => 'inline_edit.invalid_time',
    'invalidDuration' => 'inline_edit.invalid_duration',
    'chooseActivity' => 'inline_edit.choose_activity',
    'saveFailed' => 'inline_edit.save_failed',
    'tagsPlaceholder' => 'inline_edit.tags_placeholder',
    'newProject' => 'quick_create.new_project',
    'newActivity' => 'quick_create.new_activity',
    'projectName' => 'quick_create.project_name',
    'customerName' => 'quick_create.customer_name',
    'activityName' => 'quick_create.activity_name',
    'add' => 'quick_create.add',
  ];

  /**
   * @param UrlGeneratorInterface $urlGenerator Builds the script and endpoint addresses.
   * @param RequestStack $requestStack Tells which page is being rendered.
   * @param CsrfTokenManagerInterface $csrfTokenManager Creates the token the inline edit script posts.
   * @param TranslatorInterface $translator Translates the messages of the inline edit script.
   */
  public function __construct(
    private readonly UrlGeneratorInterface $urlGenerator,
    private readonly RequestStack $requestStack,
    private readonly CsrfTokenManagerInterface $csrfTokenManager,
    private readonly TranslatorInterface $translator
  )
  {
  }

  /**
   * Returns the events this subscriber listens to.
   *
   * @return array<string, string>
   */
  public static function getSubscribedEvents() : array
  {
    return [
      ThemeEvent::JAVASCRIPT => 'onJavascript',
      ThemeEvent::STYLESHEET => 'onStylesheet',
    ];
  }

  /**
   * Adds the inline edit script to the record lists.
   *
   * @param ThemeEvent $event The event that collects scripts for the end of the page.
   * @return void
   */
  public function onJavascript( ThemeEvent $event ) : void
  {
    $user = $event->getUser();
    if ( !$user instanceof User || !$this->isInlineEditPage( $user ) )
    {
      return;
    }

    $event->addContent( $this->renderScript( self::INLINE_EDIT_SCRIPT, [
      'entries-url' => $this->urlGenerator->generate( InlineEditController::ROUTE_ENTRIES ),
      'options-url' => $this->urlGenerator->generate( InlineEditController::ROUTE_OPTIONS ),
      'save-url' => $this->urlGenerator->generate( InlineEditController::ROUTE_SAVE ),
      'create-project-url' => $this->urlGenerator->generate( InlineEditController::ROUTE_CREATE_PROJECT ),
      'create-activity-url' => $this->urlGenerator->generate( InlineEditController::ROUTE_CREATE_ACTIVITY ),
      'token' => $this->csrfTokenManager->getToken( InlineEditController::CSRF_TOKEN_ID )->getValue(),
      'messages' => (string) json_encode( $this->translateMessages() ),
    ] ) );
  }

  /**
   * Adds the inline edit stylesheet to the record lists.
   *
   * @param ThemeEvent $event The event that collects stylesheets for the page head.
   * @return void
   */
  public function onStylesheet( ThemeEvent $event ) : void
  {
    $user = $event->getUser();
    if ( !$user instanceof User || !$this->isInlineEditPage( $user ) )
    {
      return;
    }

    $event->addContent( '<link rel="stylesheet" href="' . htmlspecialchars( $this->getAssetUrl( self::INLINE_EDIT_STYLESHEET ), ENT_QUOTES ) . '">' );
  }

  /**
   * Tells whether the page is a record list and the user has inline editing turned on.
   *
   * @param User $user The logged-in user.
   * @return bool
   */
  private function isInlineEditPage( User $user ) : bool
  {
    $route = $this->requestStack->getMainRequest()?->attributes->get( '_route' );

    return in_array( $route, self::LIST_ROUTES, true ) && PreferenceSubscriber::isEnabled( $user );
  }

  /**
   * Renders a module script tag with data attributes.
   *
   * @param string $name The script file name.
   * @param array<string, string> $data Data attributes, without the "data-" prefix.
   * @return string
   */
  private function renderScript( string $name, array $data ) : string
  {
    $attributes = '';
    foreach ( $data as $key => $value )
    {
      $attributes .= ' data-' . $key . '="' . htmlspecialchars( $value, ENT_QUOTES ) . '"';
    }

    return '<script type="module" src="' . htmlspecialchars( $this->getAssetUrl( $name ), ENT_QUOTES ) . '"' . $attributes . '></script>';
  }

  /**
   * Returns the versioned address of an asset.
   *
   * @param string $name The file name.
   * @return string
   */
  private function getAssetUrl( string $name ) : string
  {
    return $this->urlGenerator->generate( AssetController::ROUTE, [
      'name' => $name,
      'v' => InlineTimesheetEditBundle::getAssetVersion(),
    ] );
  }

  /**
   * Translates the messages of the inline edit script.
   *
   * @return array<string, string>
   */
  private function translateMessages() : array
  {
    return array_map(
      fn( string $key ) : string => $this->translator->trans( $key, [], InlineEditController::TRANSLATION_DOMAIN ),
      self::MESSAGES
    );
  }
}
