<?php

namespace Kubio\Theme;



class ReactAssetsRegistry {
	use Singleton;


	private static $possible_css_entries = array( 'index.css', 'style-index.css', 'style.css' );


	protected function __construct() {
		add_action( 'init', array( $this, 'registerAssets' ) );
		add_action(
			'kubio/kubio_register_packages_scripts/before_register',
			array( $this, 'afterScriptsRegistered' )
		);
	}

	public static function getTextDomain() {
		$theme = wp_get_theme();
		$domain = $theme->get('TextDomain');
		return $domain;
	}

	public function afterScriptsRegistered( $scripts ) {
		$dependent_scripts = array();

		foreach ( $scripts as $key => $script ) {
			$handle = $script[0];

			if ( ! in_array( $handle, $dependent_scripts, true ) ) {
				continue;
			}

			$dependencies = is_array( $script[2] ) ? $script[2] : array();

			$scripts[ $key ][2] = $dependencies;
		}

		return $scripts;
	}


	public function registerAssets() {
        $file_path = get_template_directory() . '/resources/react/assets-manifest.php';
        if(!file_exists($file_path)) {
            return;
        }
		$assets_manifest = require_once $file_path;

		$assets = array_map( array( $this, 'getAssetData' ), $assets_manifest );

		$this->registerScripts( $assets );
		$this->registerStytles( $assets );
	}

	public static function getAssetHandle( $name ) {
		return 'kubio-' . str_replace( '/', '_', $name );
	}

	/**
	 * Enqueue the script and style for a specified entry.
	 *
	 * @param  string $name The name of the assets group (webpack entry).
	 * @return void
	 */
	public static function enqueueAssetGroup( $name ) {
		$name = static::getAssetHandle( $name );
		wp_enqueue_style( $name );

	
		wp_enqueue_script( $name );
		$wp_scripts = wp_scripts();

		//load translation for js files
		if ($wp_scripts->query($name, 'registered')) {
			$dependencies = $wp_scripts->registered[$name]->deps;
			if ( in_array( 'wp-i18n', $dependencies, true ) ) {
				wp_set_script_translations(  $name, static::getTextDomain() );
			}
		}
	}

	/**
	 * Enqueue only the style for a specified entry.
	 *
	 * @param  string $name The name of the assets group (webpack entry).
	 * @return void
	 */
	public static function enqueueStyle( $name ) {
		$name = static::getAssetHandle( $name );
		wp_enqueue_style( $name );
	}

	/**
	 * Wrap within enqueue hook, and enqueue the script and style for a specified entry.
	 * This function detects where the enqueue is called ( admin or frontend ) and uses the correct hook
	 *
	 * @param  string $name The name of the assets group (webpack entry).
	 * @return void
	 */
	public static function enqueueAssetHooked( $name ) {
		$name = static::getAssetHandle( $name );
		$hook = is_admin() ? 'admin_enqueue_scripts' : 'wp_enqueue_scripts';

		add_action(
			$hook,
			function () use ( $name ) {
				wp_enqueue_style( $name );
				wp_enqueue_script( $name );
			}
		);
	}

	/**
	 * Wrapper over wp_add_inline_script to use the entry name
	 *
	 * @param  string $name
	 * @param  string $script
	 * @param  string $position
	 * @return void
	 */
	public static function addInlineScript( $name, $script, $position = 'after' ) {
		$name = static::getAssetHandle( $name );
		wp_add_inline_script( $name, $script, $position );
	}

	private function getAssetData( $asset ) {
		$rel = "resources/react/{$asset}";

		$data = array(
			'name'   => $asset,
			'handle' => static::getAssetHandle( $asset ),
			'css'    => null,
			'js'     => null,
		);

		if ( file_exists( get_template_directory() . '/' . $rel . '/index.js' ) ) {
            $file_name = 'index.js';
            if( file_exists(get_template_directory() . '/' . $rel . '/index.min.js')) {
                $file_name = 'index.min.js';
            }
			$path    = get_template_directory() . '/' . $rel . '/' . $file_name;
			$url     = get_template_directory_uri() . '/' . $rel . '/' . $file_name;
			$version = '';
			$deps    = array();

			if ( file_exists( get_template_directory() . '/' . $rel . '/index.asset.php' ) ) {
				$asset_data = require_once get_template_directory() . '/' . $rel . '/index.asset.php';
				$version    = $asset_data['version'];
				$deps       = $asset_data['dependencies'];
			}

			//force jquery as a depedency
			
			$deps[] = 'jquery';
			$data['js'] = array(
				'path'         => $path,
				'url'          => $url,
				'version'      => $version,
				'dependencies' => $deps,
			);
		}

		foreach ( static::$possible_css_entries as $possible_entry ) {
			if ( file_exists( get_template_directory() . '/' . $rel . '/' . $possible_entry ) ) {
				$path =get_template_directory() . '/' . $rel . '/' . $possible_entry;
				$url  = get_template_directory_uri() . '/' . $rel . '/' . $possible_entry;

				$data['css'] = array(
					'path'    => $path,
					'url'     => $url,
					'version' => filemtime( $path ),
				);

				break;
			}
		}

		return $data;
	}

	private function registerScripts( $items ) {
		$key     = 'js';
		$handles = array();

		foreach ( $items as $item ) {
			if ( empty( $item[ $key ] ) ) {
				continue;
			}

			$dependencies = $item[ $key ]['dependencies'];


			\wp_register_script( $item['handle'], $item[ $key ]['url'], $dependencies, $item[ $key ]['version'], true );

			do_action( 'kubio_registered_script', $item['handle'], $item[ $key ]['version'] );
			$handles[] = $item['handle'];
		}

		add_filter(
			'kubio/frontend/defer-script',
			function ( $defer, $handle ) use ( $handles ) {
				return ( $defer || in_array( $handle, $handles, true ) );
			},
			10,
			2
		);
	}

	private function registerStytles( $items ) {

		$key = 'css';
		foreach ( $items as $item ) {
			$dependencies = array();

			if ( empty( $item[ $key ] ) ) {
				continue;
			}

			switch ( $item['name'] ) {
				case 'black-wizard':
					$dependencies = array_merge(
						$dependencies,
						array( 'wp-components' )
					);
					break;
			}

			\wp_register_style( $item['handle'], $item[ $key ]['url'], $dependencies, $item[ $key ]['version'] );
		}
	}
}
