<?php

namespace ImageHub;

use ImageHub\Utils;


class MediaModal
{

    protected $settings;

    public function __construct($settings)
    {
        $this->settings = $settings;


        if (get_option('image_hub_enable_media_modal', true)) {
            add_action('admin_enqueue_scripts', array($this, 'image_hub_enqueue_media_library_scripts'));
			add_action('elementor/editor/after_enqueue_styles', array($this, 'image_hub_enqueue_media_library_scripts'));
            // add_action('print_media_templates', array($this, 'image_hub_create_media_library_root'));
            add_action('media_upload_image_hub_tab', array($this, 'image_hub_media_upload_handler'));

            add_action('wp_ajax_image_hub_download_image_to_library', array($this, 'image_hub_download_to_library'));

        }
    }





    public function image_hub_enqueue_media_library_scripts($id = '')
    {
        if (is_admin()) {
            Utils::enque_image_hub_script('media-modal', false);

            wp_localize_script('image-hub-media-modal', 'image_hub_settings', $this->settings);

            Utils::localize_props('image-hub-media-modal');

            wp_enqueue_style(
                'image-hub-style',
                IMAGE_HUB_ROOT_URL . '/assets/css/index.css',
                array(),
                Utils::get_version()
            );
            wp_enqueue_style('wp-components');
            wp_set_script_translations('image-hub-media-modal', 'image-hub');
        }
    }

    /**
     * Handles the AJAX request to download an image into the library.
     */
    public function image_hub_download_to_library()
    {
		if (
			!isset($_POST['nonce']) ||
			!wp_verify_nonce(sanitize_key(wp_unslash($_POST['nonce'])), 'image_hub_nonce')
		) {
			wp_send_json_error('Nonce verification failed.');
		}

        // call the callback url to notify provider that image is downloaded (unsplash terms)
        //https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download
        if (isset($_POST['downloadImageCallbackUrl']) && !empty($_POST['downloadImageCallbackUrl'])) {
            $callback_url = esc_url_raw(wp_unslash($_POST['downloadImageCallbackUrl']));

            if (filter_var($callback_url, FILTER_VALIDATE_URL)) {
                $response = wp_remote_get($callback_url);
                if (is_wp_error($response)) {
                    wp_send_json_error('Failed to fetch data from callback URL. ' . $callback_url);
                }
            } else {
                // error_log('Invalid callback URL format: ' . $_POST['downloadImageCallbackUrl']);
            }
        }

        $image_url = isset($_POST['image_url']) ? esc_url_raw(wp_unslash($_POST['image_url'])) : '';

        if (isset($_POST['provider']) && $_POST['provider'] === 'unsplash') {
            $max_width  = get_option('image_hub_max_image_width');
            $max_height = get_option('image_hub_max_image_height');
            //here add query param of width and height to the image url
            if ($max_height || $max_width)
                if ($max_height > 0 && $max_width > 0) {
                    $image_url = add_query_arg(['w' => $max_width, 'h' => $max_height], $image_url);
                } else if ($max_height > 0) {
                    $image_url = add_query_arg(['h' => $max_height], $image_url);
                } else if ($max_width > 0) {
                    $image_url = add_query_arg(['w' => $max_width], $image_url);
                }
        }

        if (empty($image_url)) {
            wp_send_json_error('No valid image URL provided.');
        }
      
        $parsed_url = wp_parse_url($image_url);

        if (empty($parsed_url['host'])) {
            wp_send_json_error('Malformed image URL.');
        }

        $host_parts = explode('.', $parsed_url['host']);
       
        // Sanitize all expected fields
        $data = [
            'title'       => sanitize_text_field(wp_unslash($_POST['title'] ?? '')),
            'name'        => sanitize_text_field(wp_unslash($_POST['name'] ?? '')),
            'description' => sanitize_textarea_field(wp_unslash($_POST['description'] ?? '')),
            'alt'         => sanitize_text_field(wp_unslash($_POST['alt'] ?? '')),
            'provider'    => sanitize_text_field(wp_unslash($_POST['provider'] ?? '')),
            'link'        => esc_url_raw(wp_unslash($_POST['link'] ?? '')),
            'username'    => sanitize_text_field(wp_unslash($_POST['username'] ?? ''))
        ];

        $data['caption'] = Utils::create_attribution($data['provider'], $data['link'], $data['username']);

        // Download image
        $image_id = Utils::download_image($image_url, $data['description']);
        if (is_wp_error($image_id)) {
            wp_send_json_error($image_id->get_error_message());
        }

        $file_path = get_attached_file($image_id);
        if (!$file_path) {
            wp_send_json_error('Failed to retrieve file path.');
        }

        $new_file_path = Utils::rename_image($file_path, $data['name'], $image_id);

        if ($data['provider'] !== 'giphy') {
            Utils::resize_image($new_file_path);
        }

        Utils::update_attachment_data($image_id, $data, $new_file_path);

        wp_send_json_success([
            'message'    => 'Image successfully downloaded and added to media library!',
            'attachment' => [
                'id'          => $image_id,
                'url'         => wp_get_attachment_url($image_id),
                'edit_url'    => get_edit_post_link($image_id),
                'alt'         => $data['alt'],
                'caption'     => $data['caption'],
                'description' => $data['description']
            ],
        ]);
    }
}
