<?php

use Kubio\Flags;

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/prepare_contact_form_plugin',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_prepare_contact_form_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/get_contact_forms',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_contact_forms',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);
	}
);


function kubio_api_prepare_contact_form_plugin( WP_REST_Request $request ) {
	//in case of failures only try init once
	$already_setup = Flags::getSetting( 'contactFormsInstalled', null );
	if ( empty( $already_setup ) ) {
		Flags::setSetting( 'contactFormsInstalled', true );
	}

	if ( ! kubio_is_recommendation_contact_form_plugin_active() ) {
		wp_send_json_error( __( 'Contact Form plugin is not active!', 'kubio' ), 400 );
	}

	$default_form = null;

	if ( $already_setup ) {
		wp_send_json_success( kubio_get_recommendation_contact_forms() );
	} else {
		// Create a default contact form
		$default_form = kubio_recommendations_create_contact_form();
		if ( ! $default_form ) {
			wp_send_json_error( __( 'Failed to create default contact form!', 'kubio' ), 500 );
		}
	}

	ob_start();
	try {
		$forms = kubio_get_recommendation_contact_forms();

		if ( empty( $forms ) ) {
			$forms = array();
		}

		$errors = ob_get_clean();


		wp_send_json_success( $forms );

	} catch ( Exception $e ) {
		$errors = ob_get_clean();

		wp_send_json_error( $e->getMessage(), 400 );
	}
}

function kubio_api_get_contact_forms( WP_REST_Request $request ) {
	wp_send_json_success( kubio_get_recommendation_contact_forms() );
}
