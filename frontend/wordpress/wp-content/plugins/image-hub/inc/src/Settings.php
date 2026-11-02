<?php

namespace ImageHub;

use ImageHub\Utils;

class Settings
{

    public $settings = [];

    public function __construct()
    {
        add_action('init', array($this, 'image_hub_register_settings'));
        add_action('init', array($this, 'image_hub_get_settings'));
        add_action('admin_menu', array($this, 'image_hub_add_settings_page'));
        add_action('admin_enqueue_scripts', array($this, 'image_hub_enqueue_admin_settings_assets'));
        add_action('wp_ajax_image_hub_update_settings', array($this, 'image_hub_update_settings'));

        $this->image_hub_get_settings();
    }

    public function image_hub_update_settings()
    {

        if (
            !isset($_POST['nonce']) ||
            !wp_verify_nonce(sanitize_key(wp_unslash($_POST['nonce'])), 'image_hub_nonce')
        ) {
            wp_send_json_error('Nonce verification failed.');
        }

        if (!isset($_POST['data'])) {
            wp_send_json_error('No data received.');
        }

        $safeData = sanitize_text_field(wp_unslash($_POST['data']));

        $updates = json_decode(stripslashes($safeData), true);
        if (!is_array($updates)) {
            wp_send_json_error('Invalid data format.');
        }

        $valid_keys = array(
            'image_hub_api_keys_giphy_api_key',
            'image_hub_api_keys_openverse_client_id',
            'image_hub_api_keys_openverse_client_secret',
            'image_hub_api_keys_pexels_api_key',
            'image_hub_api_keys_pixabay_api_key',
            'image_hub_api_keys_unsplash_access_key',
            'image_hub_max_image_height',
            'image_hub_max_image_width',
            'image_hub_enable_unsplash',
            'image_hub_enable_openverse',
            'image_hub_enable_pixabay',
            'image_hub_enable_pexels',
            'image_hub_enable_giphy',
            'image_hub_enable_image_attribution',
            'image_hub_enable_media_modal',
            'image_hub_use_default_keys'
        );
        $updated = [];

        foreach ($updates as $key => $value) {
            if (in_array($key, $valid_keys)) {
                if (strpos($key, 'enable_') !== false) {
                    $value = (bool)$value ? 1 : 0;
                }
                update_option($key, $value);
                $updated[] = $key;
            }
        }
        wp_send_json_success(['updated_keys' => $updated]);
    }

    public function image_hub_get_settings()
    {
        $this->settings = array(
            'image_hub_api_keys_giphy_api_key'      => get_option('image_hub_api_keys_giphy_api_key'),
            'image_hub_api_keys_openverse_client_id' => get_option('image_hub_api_keys_openverse_client_id'),
            'image_hub_api_keys_openverse_client_secret' => get_option('image_hub_api_keys_openverse_client_secret'),
            'image_hub_api_keys_pexels_api_key'     => get_option('image_hub_api_keys_pexels_api_key'),
            'image_hub_api_keys_pixabay_api_key'    => get_option('image_hub_api_keys_pixabay_api_key'),
            'image_hub_api_keys_unsplash_access_key' => get_option('image_hub_api_keys_unsplash_access_key'),
            'image_hub_max_image_height'            => get_option('image_hub_max_image_height'),
            'image_hub_max_image_width'             => get_option('image_hub_max_image_width'),
            'image_hub_enable_unsplash'             => (bool) get_option('image_hub_enable_unsplash', true),
            'image_hub_enable_openverse'            => (bool) get_option('image_hub_enable_openverse', true),
            'image_hub_enable_pixabay'              => (bool) get_option('image_hub_enable_pixabay', true),
            'image_hub_enable_pexels'               => (bool) get_option('image_hub_enable_pexels', true),
            'image_hub_enable_giphy'                => (bool) get_option('image_hub_enable_giphy', true),
            'image_hub_enable_image_attribution'    => (bool) get_option('image_hub_enable_image_attribution', false),
            'image_hub_enable_media_modal'          => (bool) get_option('image_hub_enable_media_modal', true),
            'image_hub_use_default_keys'          => (bool) get_option('image_hub_use_default_keys', true),
        );
    }
	function image_hub_force_store_boolean($value)
	{
		$value = sanitize_text_field($value);
		return (bool) $value;
	}
	function image_hub_sanitize_number($value)
	{
		$value = sanitize_text_field($value);
		return absint($value);
	}
    public function image_hub_register_settings()
    {

		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting(
            'image_hub_options',
            'image_hub_api_keys_giphy_api_key',
            [
                'type' => 'string',
                'sanitize_callback' => 'sanitize_text_field',
                'show_in_rest' => true,
            ]
        );
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting('image_hub_options', 'image_hub_api_keys_openverse_client_id', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'show_in_rest' => true,
        ]);
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting('image_hub_options', 'image_hub_api_keys_openverse_client_secret', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'show_in_rest' => true,
        ]);
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting('image_hub_options', 'image_hub_api_keys_pexels_api_key', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'show_in_rest' => true,
        ]);
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting('image_hub_options', 'image_hub_api_keys_pixabay_api_key', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'show_in_rest' => true,
        ]);
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting('image_hub_options', 'image_hub_api_keys_unsplash_access_key', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'show_in_rest' => true,
        ]);






		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting(
            'image_hub_options',
            'image_hub_max_image_height',
            array(
                'type'              => 'integer',
                'default'           => 1200,
                'sanitize_callback' => array($this, 'image_hub_sanitize_number'),
                'show_in_rest'      => true,
            )
        );
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting(
            'image_hub_options',
            'image_hub_max_image_width',
            array(
                'type'              => 'integer',
                'default'           => 1600,
                'sanitize_callback' => array($this,'image_hub_sanitize_number'),
                'show_in_rest'      => true,
            )
        );

        $providers = ['unsplash', 'openverse', 'pixabay', 'pexels', 'giphy'];

        foreach ($providers as $provider) {

			// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
            register_setting(
                'image_hub_options',
                'image_hub_enable_' . $provider,
                array(
                    'type'              => 'boolean',
                    'default'           => true,
                    'sanitize_callback' => array($this, 'image_hub_force_store_boolean'),
                    'show_in_rest'      => true,
                )
            );
        }

		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting(
            'image_hub_options',
            'image_hub_enable_image_attribution',
            array(
                'type'              => 'boolean',
                'default'           => false,
                'sanitize_callback' => array($this, 'image_hub_force_store_boolean'),
                'show_in_rest'      => true,
            )
        );
		// phpcs:ignore PluginCheck.CodeAnalysis.SettingSanitization.register_settingDynamic
        register_setting(
            'image_hub_options',
            'image_hub_enable_media_modal',
            array(
                'type'              => 'boolean',
                'default'           => true,
                'sanitize_callback' => array($this, 'image_hub_force_store_boolean'),
                'show_in_rest'      => true,
            )
        );
        register_setting(
            'image_hub_options',
            'image_hub_use_default_keys',
            array(
                'type'              => 'boolean',
                'default'           => true,
                'sanitize_callback' => array($this, 'image_hub_force_store_boolean'),
                'show_in_rest'      => true,
            )
        );
    }


    public function image_hub_add_settings_page()
    {
        add_options_page(
            "Image Hub Settings",
            "Image Hub",
            'manage_options',
            'image-hub-settings-page',
            array($this, 'image_hub_settings_page_renderer')
        );
    }

    public function image_hub_settings_page_renderer()
    {
?>
        <div class="wrap">
            <div id="image-hub-settings-root"></div>
        </div>
<?php
    }

    public function image_hub_enqueue_admin_settings_assets($hook)
    {
        if ('settings_page_image-hub-settings-page' !== $hook) {
            return;
        }

        wp_enqueue_style(
            'image-hub-style',
            IMAGE_HUB_ROOT_URL . '/assets/css/settings.css',
            array(),
            Utils::get_version()
        );

        Utils::enque_image_hub_script('settings', true);
        wp_enqueue_style('wp-components');

        wp_localize_script('image-hub-settings', 'image_hub_settings', $this->settings);
        Utils::localize_props('image-hub-settings');

        wp_set_script_translations('image-hub-settings', 'image-hub');
    }
}
