<?php

namespace ImageHub;



class Utils
{
    static function localize_props($name)
    {
        wp_localize_script($name, 'image_hub_data', array(
            'ajaxurl'  => admin_url('admin-ajax.php'),
            'nonce'    => wp_create_nonce('image_hub_nonce'),
            'adminUrl' => admin_url(),
            'assetBaseUrl' => IMAGE_HUB_ROOT_URL . '/assets',
            'imageUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/logo-color.svg',
            'openverseLogoUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/openverse.png',
            'giphyLogoUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/giphy.png',
            'giphyAttrUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/giphy-attr.png',
            'unsplashLogoUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/unsplash.png',
            'pixabayLogoUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/pixabay.png',
            'transparentBG' => IMAGE_HUB_ROOT_URL . '/assets/images/transparent-bg.jpg',
            'pexelsLogoUrl' => IMAGE_HUB_ROOT_URL . '/assets/images/pexels.png',
            'server_url' => Utils::get_service_url(),
            'version' => Utils::get_version(),
        ));
    }

    static function get_asset_prop($name, $prop)
    {

        $filepath = IMAGE_HUB_ROOT_DIR . 'build/' . $name . '.asset.php';
        $filepath = str_replace('\\', '/', $filepath);
        if (!file_exists($filepath)) {
            return null;
        }

        $assets = include $filepath;
        $assets['script'] = IMAGE_HUB_ROOT_URL . '//build/' . $name . '.js';

        if (!is_array($assets) || !array_key_exists($prop, $assets)) {
            return null;
        }

        return $assets[$prop];
    }


    static function enque_image_hub_script($name, $args = false)
    {

        $dependencies = Utils::get_asset_prop($name, 'dependencies');

        // Check if the asset name is 'media-modal'
        if ($name == 'media-modal') {
            // Add 'media-views' to the dependencies array if it's not already there
            if (!in_array('media-views', $dependencies)) {
                $dependencies[] = 'media-views';
            }
        }

        wp_enqueue_script(
            'image-hub-' . $name,
            Utils::get_asset_prop($name, 'script'),
            $dependencies,
            Utils::get_asset_prop($name, 'version'),
            $args
        );
    }


    /**
     * Returns the service URL using development or production values.
     */
    static function get_service_url()
    {
        $svc_temp_url = defined("IMAGE_HUB_DEV_SERVICE_URL") ? IMAGE_HUB_DEV_SERVICE_URL : IMAGE_HUB_SERVICE_URL;
        return $svc_temp_url;
    }

    /**
     * Returns the version for the plugin.
     */
    static function get_version()
    {
        $temp_version = defined("IMAGE_HUB_DEV_VERSION") ? IMAGE_HUB_DEV_VERSION : IMAGE_HUB_VERSION;
        return $temp_version == "@@buildnumber@@" ? time() : $temp_version;
    }

    /**
     * Creates an attribution string.
     */
    static function create_attribution($provider, $link, $username)
    {
        if (empty($provider) || empty($link) || empty($username)) {
            return '';
        }

        $providerFormatted = ucfirst(strtolower($provider));

        return sprintf(
            'Photo by <a href="%s?utm_source=image-hub&amp;utm_medium=referral" target="_blank" rel="noopener noreferrer">%s</a> on <a href="https://%s.com" target="_blank" rel="noopener noreferrer">%s</a>',
            esc_url($link),
            esc_html($username),
            esc_attr($provider),
            esc_html($providerFormatted)
        );
    }

    /**
     * Downloads an image, performs sanity checks, and sideloads it into the media library.
     */
    static function download_image($image_url, $description)
    {
        add_filter('http_headers_useragent', static function () {
            return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.2 Safari/537.36';
        });

        $tmp = download_url($image_url);
        if (is_wp_error($tmp)) {
            return $tmp;
        }

        $path_info = pathinfo(wp_parse_url($image_url, PHP_URL_PATH));
        $filename = isset($path_info['filename']) ? sanitize_file_name($path_info['filename']) : 'image';
        $mime_type = mime_content_type($tmp);

        $mime_extension_map = [
            'image/jpeg'    => 'jpg',
            'image/png'     => 'png',
            'image/gif'     => 'gif',
            'image/webp'    => 'webp',
            'image/svg+xml' => 'svg',
        ];

        $extension = isset($path_info['extension']) ? strtolower($path_info['extension']) : '';
        if (!$extension || !isset($mime_extension_map[$mime_type])) {
            $extension = $mime_extension_map[$mime_type] ?? 'jpg';
        }

        if (empty($extension)) {
            @wp_delete_file($tmp);
            return new \WP_Error('invalid_file_type', "Could not determine file type.");
        }

        $desired_filename = "{$filename}.{$extension}";

        $file = [
            'name'     => $desired_filename,
            'type'     => $mime_type,
            'tmp_name' => $tmp,
            'error'    => 0,
            'size'     => filesize($tmp),
        ];

        $image_id = media_handle_sideload($file, 0, $description);
        if (is_wp_error($image_id)) {
            @wp_delete_file($tmp);
            return $image_id;
        }

        return $image_id;
    }

    /**
     * Renames a downloaded image file.
     */
    static function rename_image($file_path, $new_name, $image_id)
    {
        $file_info = pathinfo($file_path);
        $new_filename = sanitize_file_name($new_name . '.' . $file_info['extension']);
        $new_file_path = $file_info['dirname'] . '/' . $new_filename;

        global $wp_filesystem;

        if (! function_exists('WP_Filesystem')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
        }

        WP_Filesystem();


        if ($wp_filesystem->move($file_path, $new_file_path)) {
            update_attached_file($image_id, $new_file_path);
            wp_update_post([
                'ID'         => $image_id,
                'post_title' => $new_filename,
                'post_name'  => sanitize_title($new_filename),
            ]);
        }

        return $new_file_path;
    }

    /**
     * Resizes an image if maximum dimensions are set.
     */
    static function resize_image($file_path)
    {

        if (
            !isset($_POST['nonce']) ||
            !wp_verify_nonce(sanitize_key(wp_unslash($_POST['nonce'])), 'image_hub_nonce')
        ) {
            wp_send_json_error('Nonce verification failed.');
        }
        if (isset($_POST['provider']) && $_POST['provider'] === 'unsplash') {
            // error_log( 'Unsplash image detected, skipping resize.' );
            return;
        }

        $editor = wp_get_image_editor($file_path);
        if (is_wp_error($editor)) {
            return;
        }

        $max_width  = get_option('image_hub_max_image_width');
        $max_height = get_option('image_hub_max_image_height');
        if ($max_width || $max_height) {
            $editor->resize($max_width, $max_height, false);
            $editor->save($file_path);
        }
    }

    /**
     * Updates attachment metadata.
     */
    static function update_attachment_data($image_id, $data, $file_path)
    {
        $attachment_data = [
            'ID'           => $image_id,
            'post_title'   => $data['title'],
            'post_content' => $data['description'],
        ];

        if (get_option('image_hub_enable_image_attribution', false)) {
            $attachment_data['post_excerpt'] = $data['caption'];
        }

        wp_update_post($attachment_data);

        if (!empty($data['alt'])) {
            update_post_meta($image_id, '_wp_attachment_image_alt', $data['alt']);
        }

        $attach_data = wp_generate_attachment_metadata($image_id, $file_path);
        wp_update_attachment_metadata($image_id, $attach_data);
    }
}
