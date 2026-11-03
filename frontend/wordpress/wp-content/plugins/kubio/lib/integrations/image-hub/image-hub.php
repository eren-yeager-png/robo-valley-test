<?php

use Kubio\PluginsManager;
use Kubio\Core\ThirdPartyPluginAssetLoaderInEditor;
use Kubio\Flags;

class KubioImageHubIntegration {
	private static $PLUGIN_SLUG = 'image-hub';


	public function __construct() {
		ThirdPartyPluginAssetLoaderInEditor::addPlugin('image-hub', array($this, 'getIsPluginActive'), false);

		// no need to show the modal if we already have the plugin or if not enabled yet
		if ( $this->getIsPluginActive()) {
			return;
		}

		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_media_library_scripts' ) );

		add_action( 'wp_ajax_kubio-image-hub-install-plugin', array( $this, 'install_image_hub_plugin' ) );
		add_filter( 'script_loader_tag', array( $this, 'add_module_attribute' ), 10, 2 );



	}

	public function getIsPluginActive() {
		$plugin_manager = PluginsManager::getInstance();
		return $plugin_manager->isPluginActive( self::$PLUGIN_SLUG );
	}




	public function enqueue_media_library_scripts() {

		wp_enqueue_style(
			'kubio-image-hub-integration-style',
			plugin_dir_url( __FILE__ ) . 'styles.css',
			array(),
			filemtime( plugin_dir_path( __FILE__ ) . 'styles.css' )
		);

		wp_enqueue_script(
			'kubio-image-hub-integration-media-modal',
			plugin_dir_url( __FILE__ ) . 'media-modal.js',
			array( 'wp-i18n', 'wp-components', 'wp-element', 'media-views', 'kubio-utils', 'wp-dom-ready' ),
			filemtime( plugin_dir_path( __FILE__ ) . 'media-modal.js' ),
			true
		);

		wp_enqueue_style( 'kubio-utils' );
		wp_enqueue_style( 'wp-components' );
	}


	public function add_module_attribute( $tag, $handle ) {
		if ( 'kubio-image-hub-integration-media-modal' === $handle ) {
			return str_replace( 'src', 'type="module" src', $tag );
		}
		return $tag;
	}


	public function install_image_hub_plugin() {
		check_ajax_referer( 'kubio_ajax_nonce' );
		if(!current_user_can( 'install_plugins' )) {
			wp_send_json_error('Not allowed');
		}
		$plugin_manager = PluginsManager::getInstance();
		$plugin_manager->installPlugin( self::$PLUGIN_SLUG );
		$plugin_manager->activatePlugin( self::$PLUGIN_SLUG, false );

		wp_send_json_success( 'Plugin installed successfully' );
	}


	public static function init() {
		new self();
	}
}

KubioImageHubIntegration::init();
