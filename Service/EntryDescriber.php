<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\Service;

use App\Entity\Timesheet;
use App\Entity\User;
use App\Repository\TimesheetRepository;
use App\Timesheet\DateTimeFactory;
use DateTimeImmutable;
use DateTimeZone;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;

/**
 * Describes the user's own records that may be edited in the list, with the raw values the
 * editors start from.
 *
 * @phpstan-type EntryValues array{
 *   date: string,
 *   begin: string,
 *   end: string,
 *   duration: int,
 *   break: int,
 *   description: string,
 *   projectId: int,
 *   projectName: string,
 *   activityId: int,
 *   activityName: string,
 *   tags: array<int, string>,
 *   billable: bool,
 *   fields: array<int, string>
 * }
 */
final class EntryDescriber
{
  /**
   * Most records described in one request; a page of the list holds far fewer.
   *
   * @var int
   */
  public const MAX_ENTRIES = 500;

  /**
   * Seconds per minute.
   *
   * @var int
   */
  private const MINUTE = 60;

  /**
   * @param TimesheetRepository $repository Loads the records.
   * @param AuthorizationCheckerInterface $security Checks the edit permission.
   * @param EntryEditor $editor Tells which fields may be changed.
   */
  public function __construct(
    private readonly TimesheetRepository $repository,
    private readonly AuthorizationCheckerInterface $security,
    private readonly EntryEditor $editor
  )
  {
  }

  /**
   * Returns one of the user's own records that they may edit, or null.
   *
   * @param User $user The logged-in user.
   * @param int $id The record ID.
   * @return Timesheet|null
   */
  public function findEditable( User $user, int $id ) : ?Timesheet
  {
    $entry = $id > 0 ? $this->repository->find( $id ) : null;

    return $entry !== null && $this->isEditable( $user, $entry ) ? $entry : null;
  }

  /**
   * Describes the records with the given IDs that the user owns and may edit.
   *
   * @param User $user The logged-in user.
   * @param array<int, int> $ids Record IDs from the list.
   * @return array<int, EntryValues>
   */
  public function describe( User $user, array $ids ) : array
  {
    $timezone = DateTimeFactory::createByUser( $user )->getTimezone();
    $entries = [];

    foreach ( $this->repository->findBy( [ 'id' => array_slice( array_unique( $ids ), 0, self::MAX_ENTRIES ) ] ) as $entry )
    {
      $begin = $entry->getBegin();
      if ( $begin !== null && $this->isEditable( $user, $entry ) )
      {
        $entries[ (int) $entry->getId() ] = $this->describeEntry( $entry, DateTimeImmutable::createFromMutable( $begin )->setTimezone( $timezone ), $timezone );
      }
    }

    return $entries;
  }

  /**
   * Tells whether the record belongs to the user and they may edit it.
   *
   * @param User $user The logged-in user.
   * @param Timesheet $entry The record.
   * @return bool
   */
  private function isEditable( User $user, Timesheet $entry ) : bool
  {
    return $entry->getUser()?->getId() === $user->getId() && $this->security->isGranted( 'edit', $entry );
  }

  /**
   * Describes one record.
   *
   * @param Timesheet $entry The record.
   * @param DateTimeImmutable $begin The start of the record in the user's time zone.
   * @param DateTimeZone $timezone The user's time zone.
   * @return EntryValues
   */
  private function describeEntry( Timesheet $entry, DateTimeImmutable $begin, DateTimeZone $timezone ) : array
  {
    $end = $entry->getEnd() === null ? null : DateTimeImmutable::createFromMutable( $entry->getEnd() )->setTimezone( $timezone );

    $tags = [];
    foreach ( $entry->getTags() as $tag )
    {
      $tags[] = (string) $tag->getName();
    }

    return [
      'date' => $begin->format( 'Y-m-d' ),
      'begin' => $begin->format( 'H:i' ),
      'end' => $end?->format( 'H:i' ) ?? '',
      'duration' => intdiv( (int) $entry->getDuration(), self::MINUTE ),
      'break' => intdiv( $entry->getBreak(), self::MINUTE ),
      'description' => (string) $entry->getDescription(),
      'projectId' => (int) $entry->getProject()?->getId(),
      'projectName' => (string) $entry->getProject()?->getName(),
      'activityId' => (int) $entry->getActivity()?->getId(),
      'activityName' => (string) $entry->getActivity()?->getName(),
      'tags' => $tags,
      'billable' => $entry->isBillable(),
      'fields' => $this->editor->getEditableFields( $entry ),
    ];
  }
}
