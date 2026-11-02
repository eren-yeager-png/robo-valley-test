<?php
/**
 * Plugin Name:       Image Hub
 * Plugin URI:        https://wpimagehub.com
 * Description:       Access and manage royalty-free images from Unsplash, Pixabay, Pexels, Openverse & Giphy without leaving your WordPress dashboard.
 * Version:           1.2.0
 * Author: 			  ExtendThemes
 * Author URI: 		  https://extendthemes.com
 * Text Domain:       image-hub
 * License:           GPL-3.0+
 * License URI:       https://www.gnu.org/licenses/gpl-3.0.txt
 * Requires PHP: 	  7.4
 * Requires at least: 6.5
 */

if (! defined('ABSPATH')) {
    exit; // Exit if accessed directly
}


define('IMAGE_HUB_ENTRY_FILE', __FILE__ );
define('IMAGE_HUB_ROOT_DIR', plugin_dir_path( __FILE__ ) );
define('IMAGE_HUB_ROOT_URL', untrailingslashit( plugin_dir_url( __FILE__ ) ) );
define("IMAGE_HUB_SERVICE_URL", "https://api.wpimagehub.com");
define("IMAGE_HUB_VERSION", "1.2.0");
define("IMAGE_HUB_BUILD_NUMBER", '20' );
define("IMAGE_HUB_PLUGIN_NAME", "Image Hub");

require_once plugin_dir_path( __FILE__ ) . 'vendor/autoload.php';

use ImageHub\Admin;
use ImageHub\MediaModal;
use ImageHub\Settings;



function image_hub_init() {

    global $image_hub;
    if (! isset($image_hub) && is_admin()) {



        $settings_instance = new Settings();
        $admin_instance  = new Admin($settings_instance->settings);
        $media_instance  = new MediaModal($settings_instance->settings);
        $image_hub = array(
            'settings' => $settings_instance,
            'admin'    => $admin_instance,
            'media'    => $media_instance,
        );
    }
    return $image_hub;
}

image_hub_init();
