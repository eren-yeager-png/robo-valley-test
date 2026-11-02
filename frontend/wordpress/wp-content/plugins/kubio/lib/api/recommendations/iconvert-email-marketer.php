<?php

use Kubio\Core\Utils;

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/prepare_iconvert_email_marketer_plugin',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_prepare_iconvert_email_marketer_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);
	}
);



function kubio_api_prepare_iconvert_email_marketer_plugin( WP_REST_Request $request ) {

	if ( ! Utils::getIsIconvertEmailMarketerActive() ) {
		wp_send_json_error( __( 'Required plugin is missing', 'kubio' ), 400 );
	}

	$form_id = sanitize_text_field( $request->get_param( 'form_id' ) );
	$form_id = intval( $form_id );
	if ( empty( $form_id ) || is_nan( $form_id ) ) {
		wp_send_json_error( __( 'Invalid form id', 'kubio' ), 400 );
	}

	//in case of failures only try init once
	$already_setup = get_option( 'iconvertEmailMarketerThirdPartyInited', null );

	if ( $already_setup ) {
		// wp_send_json_success();
	}
	update_option( 'iconvertEmailMarketerThirdPartyInited', true );
	try {

		kubio_iconvert_email_marketer_create_default_template( $form_id );
		wp_send_json_success();

	} catch ( Exception $e ) {
		wp_send_json_error( $e->getMessage(), 400 );

	}
}
function kubio_iconvert_email_marketer_create_default_template( $form_id ) {
	if ( empty( $form_id ) ) {
		return;
	}
	$request = new WP_REST_Request(
		'POST',
		'/iconvertem/v1/create-template'
	);

	// get contact form title
	$cf_title = get_post_field( 'post_title', $form_id );
	$title = sprintf( __( '%s - Confirmation Email', 'kubio' ), $cf_title );

	$request->set_body_params(
		array(
			'title'                 => $title,
			'email_type'            => 'icem-mail-tpl-taxonomy-type-transactional',
			'sending_event_form_id' => $form_id,
			'sending_event_type'    => 'afterContactForm7Submission',
			'template_id'           => '227',
			'email_subject'         => __( 'Thanks for contacting us', 'kubio' ),
		)
	);

	$response = rest_do_request( $request );

	$data = $response->get_data();
	if(is_array($data) && isset($data['success'])) {

		$template_id = $data['data']['id'] ?? null;
		if ( ! empty( $template_id ) ) {
			$originally_disabled = get_post_meta( $template_id, '_iconvertem_email_disabled', true );
			update_post_meta( $template_id, '_iconvertem_email_disabled', '1', $originally_disabled );
		}

		return $data['success'];
	}
	return false;
}
