<?php

declare( strict_types=1 );

namespace KimaiPlugin\InlineTimesheetEditBundle\DependencyInjection;

use Symfony\Component\Config\FileLocator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Extension\Extension;
use Symfony\Component\DependencyInjection\Loader\YamlFileLoader;

/**
 * Registers the services of the inline timesheet editing.
 */
final class InlineTimesheetEditExtension extends Extension
{
  /**
   * Loads the service definitions of the bundle.
   *
   * @param array<mixed> $configs The bundle configuration, unused.
   * @param ContainerBuilder $container The container being built.
   * @return void
   */
  public function load( array $configs, ContainerBuilder $container ) : void
  {
    $loader = new YamlFileLoader( $container, new FileLocator( __DIR__ . '/../Resources/config' ) );
    $loader->load( 'services.yaml' );
  }
}
