<?php

namespace ImageHub;

use ImageHub\Utils;

class Admin {

    protected $settings;

    public function __construct($settings) {
        $this->settings = $settings;

        add_action('admin_menu', array($this, 'image_hub_add_admin_media_page'));
        add_action('admin_enqueue_scripts', array($this, 'image_hub_enqueue_admin_assets'));

        add_action('current_screen', function () {
            $screen = get_current_screen();
            if ($screen && str_contains((string)$screen->id, 'image-hub')) {
                add_filter('admin_footer_text', array($this, 'image_hub_remove_footer_admin'));
            }
        });

		add_filter( 'plugin_row_meta', array($this, 'onUdatePluginBuild'), 10, 4 );
    }

	public function onUdatePluginBuild($plugin_meta, $plugin_file) {
		$plugins_dir = trailingslashit(
			wp_normalize_path( WP_CONTENT_DIR . '/plugins/' )
		);
		$image_hub_file  = str_replace(
			$plugins_dir,
			'',
			wp_normalize_path( IMAGE_HUB_ENTRY_FILE )
		);
		if ( $plugin_file === $image_hub_file ) {
			$plugin_meta[0] =
				"{$plugin_meta[0]} (build: " . IMAGE_HUB_BUILD_NUMBER . ')';
		}

		return $plugin_meta;
	}
    public function image_hub_add_admin_media_page() {
        add_media_page(
            'Image Hub',
            'Image Hub',
            'manage_options',
            'image-hub-media-tab',
            array($this, 'image_hub_admin_media_page_content')
        );
    }

    public function image_hub_admin_media_page_content() {
        ?>
        <div class="wrap">
            <div id="image-hub-root"></div>
        </div>
        <?php
    }

    public function image_hub_enqueue_admin_assets($hook) {
        if ('media_page_image-hub-media-tab' !== $hook) {
            return;
        }

        wp_enqueue_style(
            'image-hub-style',
            IMAGE_HUB_ROOT_URL . '/assets/css/index.css',
            array(),
            Utils::get_version()
        );

        Utils::enque_image_hub_script('admin', true);

        wp_enqueue_style('wp-components');
        wp_localize_script('image-hub-admin', 'image_hub_settings', $this->settings);

        Utils::localize_props('image-hub-admin');

        wp_set_script_translations('image-hub-admin', 'image-hub');
    }

    public function image_hub_remove_footer_admin() {

        return __('Image Hub – Discover and download beautiful images from free sources with ease.','image-hub');
    }
}
