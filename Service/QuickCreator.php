<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\Service;

use App\Activity\ActivityService;
use App\Customer\CustomerService;
use App\Entity\Activity;
use App\Entity\Customer;
use App\Entity\Project;
use App\Entity\User;
use App\Project\ProjectService;
use App\Repository\ActivityRepository;
use App\Repository\CustomerRepository;
use App\Repository\ProjectRepository;
use App\Repository\Query\ActivityFormTypeQuery;
use App\Repository\Query\CustomerFormTypeQuery;
use App\Repository\Query\ProjectFormTypeQuery;
use App\Validator\ValidationFailedException;
use KimaiPlugin\InlineTimesheetEditBundle\Exception\InvalidInputException;
use Symfony\Component\Security\Core\Authorization\AuthorizationCheckerInterface;

/**
 * Creates projects, customers and activities from just a name, with Kimai's defaults, the way
 * Toggl's quick create works. Everything else can be changed later in Kimai's own forms.
 *
 * A name that already exists is reused instead of creating a duplicate. Creating needs Kimai's
 * create_project, create_customer and create_activity permissions.
 *
 * Keep in sync with the copy in the other plugin, which differs only in its namespace.
 */
final class QuickCreator
{
  /**
   * Kimai's permission for creating projects.
   *
   * @var string
   */
  public const PERMISSION_PROJECT = 'create_project';

  /**
   * Kimai's permission for creating customers.
   *
   * @var string
   */
  public const PERMISSION_CUSTOMER = 'create_customer';

  /**
   * Kimai's permission for creating activities.
   *
   * @var string
   */
  public const PERMISSION_ACTIVITY = 'create_activity';

  /**
   * Longest name Kimai stores for a customer, project or activity.
   *
   * @var int
   */
  private const MAX_NAME_LENGTH = 150;

  /**
   * @param AuthorizationCheckerInterface $security Checks the create permissions.
   * @param CustomerService $customerService Creates and saves customers with Kimai's defaults.
   * @param ProjectService $projectService Creates and saves projects with Kimai's defaults.
   * @param ActivityService $activityService Creates and saves activities with Kimai's defaults.
   * @param CustomerRepository $customerRepository Finds the customers the user may see.
   * @param ProjectRepository $projectRepository Finds the projects the user may book on.
   * @param ActivityRepository $activityRepository Finds the activities the user may book on.
   */
  public function __construct(
    private readonly AuthorizationCheckerInterface $security,
    private readonly CustomerService $customerService,
    private readonly ProjectService $projectService,
    private readonly ActivityService $activityService,
    private readonly CustomerRepository $customerRepository,
    private readonly ProjectRepository $projectRepository,
    private readonly ActivityRepository $activityRepository
  )
  {
  }

  /**
   * Tells what the user may create, for showing the buttons.
   *
   * @return array{project: bool, customer: bool, activity: bool}
   */
  public function getPermissions() : array
  {
    return [
      'project' => $this->security->isGranted( self::PERMISSION_PROJECT ),
      'customer' => $this->security->isGranted( self::PERMISSION_CUSTOMER ),
      'activity' => $this->security->isGranted( self::PERMISSION_ACTIVITY ),
    ];
  }

  /**
   * Returns the names of the visible customers, ordered by name, for suggestions.
   *
   * @param User $user The logged-in user.
   * @return array<int, string>
   */
  public function getCustomerNames( User $user ) : array
  {
    return array_values( array_map( fn( Customer $customer ) : string => (string) $customer->getName(), $this->findCustomers( $user ) ) );
  }

  /**
   * Returns the project with this name under the customer, creating the project, and the
   * customer when it does not exist yet.
   *
   * @param User $user The logged-in user.
   * @param string $name The project name.
   * @param string $customerName The name of an existing or new customer.
   * @return Project
   * @throws InvalidInputException When a name is missing or the user may not create something.
   * @throws ValidationFailedException When Kimai refuses the new customer or project.
   */
  public function createProject( User $user, string $name, string $customerName ) : Project
  {
    $name = $this->cleanName( $name );
    $customerName = $this->cleanName( $customerName );
    $customer = $this->findByName( $this->findCustomers( $user ), $customerName, fn( Customer $customer ) : bool => true );

    $existing = $customer === null ? null : $this->findByName( $this->findProjects( $user ), $name, fn( Project $project ) : bool => $project->getCustomer()?->getId() === $customer->getId() );
    if ( $existing !== null )
    {
      return $existing;
    }

    // Checked before a new customer is made, so a refusal leaves nothing behind.
    $this->requirePermission( self::PERMISSION_PROJECT );
    $customer ??= $this->createCustomer( $customerName );
    $project = $this->projectService->createNewProject( $customer );
    $project->setName( $name );

    return $this->projectService->saveProject( $project );
  }

  /**
   * Returns the activity with this name, creating it when it does not exist yet. It is global,
   * unless the project only allows its own activities; then it belongs to the project.
   *
   * @param User $user The logged-in user.
   * @param string $name The activity name.
   * @param Project|null $project The project selected next to it, if any.
   * @return Activity
   * @throws InvalidInputException When the name is missing or the user may not create activities.
   * @throws ValidationFailedException When Kimai refuses the new activity.
   */
  public function createActivity( User $user, string $name, ?Project $project ) : Activity
  {
    $name = $this->cleanName( $name );
    $owner = $project !== null && !$project->isGlobalActivities() ? $project : null;

    $existing = $this->findByName( $this->findActivities( $user ), $name, fn( Activity $activity ) : bool => $activity->getProject()?->getId() === $owner?->getId() );
    if ( $existing !== null )
    {
      return $existing;
    }

    $this->requirePermission( self::PERMISSION_ACTIVITY );
    $activity = $this->activityService->createNewActivity( $owner );
    $activity->setName( $name );

    return $this->activityService->saveActivity( $activity );
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
   * Creates a customer with Kimai's defaults for country, currency, language and time zone.
   *
   * @param string $name The customer name.
   * @return Customer
   * @throws InvalidInputException When the user may not create customers.
   */
  private function createCustomer( string $name ) : Customer
  {
    $this->requirePermission( self::PERMISSION_CUSTOMER );

    return $this->customerService->saveCustomer( $this->customerService->createNewCustomer( $name ) );
  }

  /**
   * Returns the first item with this name, ignoring case, that also passes the filter.
   *
   * @template T of Customer|Project|Activity
   * @param array<int, T> $items The items to search.
   * @param string $name The name.
   * @param callable(T): bool $filter Further condition.
   * @return T|null
   */
  private function findByName( array $items, string $name, callable $filter ) : Customer|Project|Activity|null
  {
    foreach ( $items as $item )
    {
      if ( mb_strtolower( (string) $item->getName() ) === mb_strtolower( $name ) && $filter( $item ) )
      {
        return $item;
      }
    }

    return null;
  }

  /**
   * Trims a name and checks that it is usable.
   *
   * @param string $name The typed name.
   * @return string
   * @throws InvalidInputException When the name is empty or too long.
   */
  private function cleanName( string $name ) : string
  {
    $name = trim( $name );
    if ( $name === '' || mb_strlen( $name ) > self::MAX_NAME_LENGTH )
    {
      throw new InvalidInputException( 'quick_create.name_required' );
    }

    return $name;
  }

  /**
   * Checks a create permission.
   *
   * @param string $permission The permission.
   * @return void
   * @throws InvalidInputException When the user lacks it.
   */
  private function requirePermission( string $permission ) : void
  {
    if ( !$this->security->isGranted( $permission ) )
    {
      throw new InvalidInputException( 'quick_create.' . $permission );
    }
  }

  /**
   * Returns the visible customers by ID.
   *
   * @param User $user The logged-in user.
   * @return array<int, Customer>
   */
  private function findCustomers( User $user ) : array
  {
    $query = new CustomerFormTypeQuery();
    $query->setUser( $user );

    return $this->indexById( $this->customerRepository->getQueryBuilderForFormType( $query )->getQuery()->getResult(), Customer::class );
  }

  /**
   * Returns the projects the user may book on, by ID.
   *
   * @param User $user The logged-in user.
   * @return array<int, Project>
   */
  private function findProjects( User $user ) : array
  {
    $query = new ProjectFormTypeQuery();
    $query->setUser( $user );

    return $this->indexById( $this->projectRepository->getQueryBuilderForFormType( $query )->getQuery()->getResult(), Project::class );
  }

  /**
   * Returns the activities the user may book on, by ID.
   *
   * @param User $user The logged-in user.
   * @return array<int, Activity>
   */
  private function findActivities( User $user ) : array
  {
    $query = new ActivityFormTypeQuery();
    $query->setUser( $user );

    return $this->indexById( $this->activityRepository->getQueryBuilderForFormType( $query )->getQuery()->getResult(), Activity::class );
  }

  /**
   * Keeps the entities of one class from a query result, by ID.
   *
   * @template T of Customer|Project|Activity
   * @param mixed $result The query result.
   * @param class-string<T> $class The entity class.
   * @return array<int, T>
   */
  private function indexById( mixed $result, string $class ) : array
  {
    $items = [];
    if ( !is_iterable( $result ) )
    {
      return $items;
    }

    foreach ( $result as $item )
    {
      if ( $item instanceof $class && $item->getId() !== null )
      {
        $items[ $item->getId() ] = $item;
      }
    }

    return $items;
  }
}
