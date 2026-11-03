<?php

use Kubio\Flags;

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/prepare_fluent_booking_plugin',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_prepare_fluent_booking_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/get_fluent_events',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_fluent_events',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);
	}
);



function kubio_api_prepare_fluent_booking_plugin( WP_REST_Request $request ) {
	$already_setup = Flags::getSetting( 'fluentBookingInstalled', null );
	if ( empty( $already_setup ) ) {
		Flags::setSetting( 'fluentBookingInstalled', true );
	}
	wp_send_json_success();
}

function kubio_api_get_fluent_events( WP_REST_Request $request ) {

	wp_send_json_success( kubio_get_fluent_booking_events() );
}
