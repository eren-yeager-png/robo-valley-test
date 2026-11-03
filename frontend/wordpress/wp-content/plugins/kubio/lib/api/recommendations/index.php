<?php



require_once __DIR__ . '/contact-forms.php';
require_once __DIR__ . '/newsletter/index.php';
require_once __DIR__ . '/fluent-booking.php';
require_once __DIR__ . '/siteleads.php';
require_once __DIR__ . '/iconvert-email-marketer.php';

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/get-recommendation-page-content-by-plugin',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_recommendation_page_content_by_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/get-recommendation-default-settings',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_recommendation_default_settings',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		register_rest_route(
			$namespace,
			'/get-recommendations-settings',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_recommendations_settings',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
);


function kubio_api_get_recommendation_page_content_by_plugin( WP_REST_Request $request ) {
	$plugin_slug    = $request->get_param( 'pluginSlug' );
	$page_file_name = null;
	switch ( $plugin_slug ) {
		case 'contact-form-7':
			$page_file_name = 'contact-form-page.html';
			break;
		case 'fluent-booking':
			$page_file_name = 'fluent-form-page.html';
			break;
	}
	if ( empty( $page_file_name ) ) {
		wp_send_json_error( __( 'Page content not found for given plugin', 'kubio' ), 404 );
	}

	$page_file_path = KUBIO_ROOT_DIR . '/defaults/recommendations-pages/' . $page_file_name;

	if ( ! file_exists( $page_file_path ) ) {
		wp_send_json_error( __( 'Page content not found for given plugin', 'kubio' ), 404 );
	}
	$content = file_get_contents( $page_file_path );
	wp_send_json_success( $content );
}


function kubio_api_get_recommendation_default_settings( WP_REST_Request $request ) {
	$plugin_slug = $request->get_param( 'plugin' );
	if ( empty( $plugin_slug ) ) {
		wp_send_json_error( __( 'Plugin slug is required', 'kubio' ), 400 );
	}

	$url = 'https://kubiobuilder.com/wp-json/kubio-recommentation-defaults/' . urlencode( $plugin_slug );

	$response = wp_remote_get(
		$url
	);

	if ( is_wp_error( $response ) ) {
		wp_send_json_error( __( 'Failed to fetch default settings', 'kubio' ), 500 );
	}

	$body = wp_remote_retrieve_body( $response );
	$code = wp_remote_retrieve_response_code( $response );

	if ( $code !== 200 ) {
		wp_send_json_error( __( 'Failed to fetch default settings', 'kubio' ), $code );
	}

	if ( empty( $body ) ) {
		wp_send_json_error( __( 'No default settings found for the plugin', 'kubio' ), 404 );
	}
	$default_settings = json_decode( $body, true );

	if ( ! is_array( $default_settings ) ) {
		wp_send_json_error( __( 'Invalid default settings format', 'kubio' ), 500 );
	}

	wp_send_json_success( $default_settings );
}


function kubio_api_get_recommendations_settings( WP_REST_Request $request ) {

	$settings = kubio_get_recommendations_settings();

	foreach ( array_keys( $settings ) as $key ) {
		switch ( $key ) {
			case 'contactForm':
				$settings[ $key ]['itemsList'] = kubio_get_recommendation_contact_forms();
				break;
			case 'newsletters':
				$settings[ $key ]['itemsList'] = kubio_get_recommendation_newsletters();
				break;
			case 'fluentBooking':
				$settings[ $key ]['itemsList'] = kubio_get_fluent_booking_events();
				break;
			case 'siteleads':
				$settings[ $key ]['itemsList'] = kubio_get_siteleads_widgets();
				break;
		}
	}

	return $settings;
}
