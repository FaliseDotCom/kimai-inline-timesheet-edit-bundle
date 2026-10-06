<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\Service;

use App\Entity\Activity;
use App\Entity\Project;
use App\Entity\Tag;
use App\Entity\User;
use App\Repository\ActivityRepository;
use App\Repository\ProjectRepository;
use App\Repository\Query\ActivityFormTypeQuery;
use App\Repository\Query\ProjectFormTypeQuery;
use App\Repository\TagRepository;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;

/**
 * The projects, activities and tags a user can pick when editing a record in the list.
 *
 * @phpstan-type ProjectOption array{id: int, name: string, globalActivities: bool}
 * @phpstan-type CustomerGroup array{name: string, projects: array<int, ProjectOption>}
 * @phpstan-type ActivityOption array{id: int, name: string, projectId: int}
 * @phpstan-type Options array{customers: array<int, CustomerGroup>, activities: array<int, ActivityOption>, tags: array<int, string>, canCreateTags: bool}
 */
final class BookingOptions
{
  /**
   * @param ProjectRepository $projectRepository Finds the projects a user may book on.
   * @param ActivityRepository $activityRepository Finds the activities a user may book on.
   * @param TagRepository $tagRepository Finds and stores tags.
   * @param AuthorizationCheckerInterface $security Checks the tag permission.
   */
  public function __construct(
    private readonly ProjectRepository $projectRepository,
    private readonly ActivityRepository $activityRepository,
    private readonly TagRepository $tagRepository,
    private readonly AuthorizationCheckerInterface $security
  )
  {
  }

  /**
   * Describes everything the pickers offer.
   *
   * @param User $user The logged-in user.
   * @return Options
   */
  public function describe( User $user ) : array
  {
    $projects = $this->findProjects( $user );
    $activities = [];
    foreach ( $this->findActivities( $user, array_values( $projects ) ) as $id => $activity )
    {
      $activities[] = [
        'id' => $id,
        'name' => (string) $activity->getName(),
        'projectId' => (int) $activity->getProject()?->getId(),
      ];
    }

    $tags = [];
    foreach ( $this->tagRepository->findAllTags() as $tag )
    {
      $tags[] = (string) $tag->getName();
    }

    return [
      'customers' => $this->groupProjectsByCustomer( $projects ),
      'activities' => $activities,
      'tags' => $tags,
      'canCreateTags' => $this->canCreateTags(),
    ];
  }

  /**
   * Returns a project the user may book on, or null.
   *
   * @param User $user The logged-in user.
   * @param int $id The project ID.
   * @return Project|null
   */
  public function findProject( User $user, int $id ) : ?Project
  {
    return $this->findProjects( $user )[ $id ] ?? null;
  }

  /**
   * Returns an activity the user may book on the project, or null.
   *
   * @param User $user The logged-in user.
   * @param int $id The activity ID.
   * @param Project $project The project of the record.
   * @return Activity|null
   */
  public function findActivity( User $user, int $id, Project $project ) : ?Activity
  {
    $activity = $this->findActivities( $user, [ $project ] )[ $id ] ?? null;

    return $activity !== null && $this->fitsProject( $activity, $project ) ? $activity : null;
  }

  /**
   * Tells whether an activity can be booked on a project: its own activities, and global ones
   * when the project allows them.
   *
   * @param Activity $activity The activity.
   * @param Project $project The project.
   * @return bool
   */
  public function fitsProject( Activity $activity, Project $project ) : bool
  {
    $activityProject = $activity->getProject();

    if ( $activityProject === null )
    {
      return $project->isGlobalActivities();
    }

    return $activityProject->getId() === $project->getId();
  }

  /**
   * Returns the tags with the given names. Missing tags are created when the user may create
   * tags; otherwise they are returned in the second list.
   *
   * @param array<int, string> $names Tag names.
   * @return array{0: array<int, Tag>, 1: array<int, string>}
   */
  public function findOrCreateTags( array $names ) : array
  {
    $tags = [];
    $missing = [];
    foreach ( $names as $name )
    {
      $tag = $this->tagRepository->findTagByName( $name );

      if ( $tag === null && $this->canCreateTags() )
      {
        $tag = new Tag();
        $tag->setName( $name );
        $this->tagRepository->saveTag( $tag );
      }

      if ( $tag === null )
      {
        $missing[] = $name;
        continue;
      }

      $tags[] = $tag;
    }

    return [ $tags, $missing ];
  }

  /**
   * Tells whether the user may create tags.
   *
   * @return bool
   */
  private function canCreateTags() : bool
  {
    return $this->security->isGranted( 'create_tag' );
  }

  /**
   * Returns the visible projects the user may book on, ordered by customer and name.
   *
   * @param User $user The logged-in user.
   * @return array<int, Project>
   */
  private function findProjects( User $user ) : array
  {
    $query = new ProjectFormTypeQuery();
    $query->setUser( $user );
    $query->setWithCustomer( true );

    $projects = [];
    foreach ( $this->projectRepository->getQueryBuilderForFormType( $query )->getQuery()->getResult() as $project )
    {
      if ( $project instanceof Project && $project->getId() !== null )
      {
        $projects[ $project->getId() ] = $project;
      }
    }

    return $projects;
  }

  /**
   * Returns the visible activities the user may book on the projects: their own activities,
   * and global ones (for a single project, only when it allows them).
   *
   * @param User $user The logged-in user.
   * @param array<int, Project> $projects The projects; without any, only global activities.
   * @return array<int, Activity>
   */
  private function findActivities( User $user, array $projects ) : array
  {
    $query = new ActivityFormTypeQuery( null, $projects === [] ? null : $projects );
    $query->setUser( $user );

    $activities = [];
    foreach ( $this->activityRepository->getQueryBuilderForFormType( $query )->getQuery()->getResult() as $activity )
    {
      if ( $activity instanceof Activity && $activity->getId() !== null )
      {
        $activities[ $activity->getId() ] = $activity;
      }
    }

    return $activities;
  }

  /**
   * Groups the projects under their customer, keeping the repository's order.
   *
   * @param array<int, Project> $projects Bookable projects by ID.
   * @return array<int, CustomerGroup>
   */
  private function groupProjectsByCustomer( array $projects ) : array
  {
    $customers = [];
    foreach ( $projects as $id => $project )
    {
      $customer = $project->getCustomer();
      $customerId = (int) $customer?->getId();

      $customers[ $customerId ] ??= [ 'name' => $customer?->getName() ?? '', 'projects' => [] ];
      $customers[ $customerId ][ 'projects' ][] = [
        'id' => $id,
        'name' => (string) $project->getName(),
        'globalActivities' => $project->isGlobalActivities(),
      ];
    }

    return array_values( $customers );
  }
}
