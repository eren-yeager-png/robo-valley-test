<?php

use IlluminateAgnostic\Arr\Support\Arr;
use Kubio\Flags;

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/prepare_newsletter_plugin',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_prepare_newsletter_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/get_newsletters',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_newsletters',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);
	}
);



function kubio_api_prepare_newsletter_plugin( WP_REST_Request $request ) {
	//in case of failures only try init once
	$already_setup = Flags::getSetting( 'newslettersInstalled', null );
	if ( empty( $already_setup ) ) {
		Flags::setSetting( 'newslettersInstalled', true );
	}

	if ( ! kubio_is_recommendation_newsletter_plugin_active() ) {
		wp_send_json_error( __( 'Promo plugin is not active!', 'kubio' ), 400 );
	}
	if ( ! class_exists( '\CSPromo\Core\Admin\PopupService' ) ) {
		wp_send_json_error( __( 'At least one of required classes is missing', 'kubio' ), 400 );
	}
	if ( ! method_exists( '\CSPromo\Core\Admin\PopupService', 'create' ) ) {
		wp_send_json_error( __( 'At least one of required functions is missing', 'kubio' ), 400 );
	}

	if ( $already_setup ) {
		wp_send_json_success( kubio_get_recommendation_newsletters() );
	}

	ob_start();
	try {

		// Create Popup By Click and activate
		$popup_by_click_data = require_once __DIR__ . '/defaults/default-popup-by-click.php';

		$popup_by_click_id = kubio_recommendations_create_promo_popup( $popup_by_click_data );

		kubio_recommendation_set_click_promo_popup_triggers( $popup_by_click_id );

		$popups = kubio_get_recommendation_newsletters();

		$errors = ob_get_clean();

		wp_send_json_success( $popups );
	} catch ( Exception $e ) {
		$errors = ob_get_clean();

		wp_send_json_error( $e->getMessage(), 400 );
	}
}



function kubio_api_get_newsletters( WP_REST_Request $request ) {

	wp_send_json_success( kubio_get_recommendation_newsletters() );
}



function kubio_setup_click_promo_trigger_for_blocks( $blocks ) {

	foreach ( $blocks as $block ) {
		if ( isset( $block['blockName'] ) && 'kubio/button' === $block['blockName'] ) {
			// Assuming the block has an attribute for the popup ID
			$popup_id  = Arr::get( $block, 'attrs.recommendation.newsletter.id', null );
			$link_type = Arr::get( $block, 'attrs.linkType', null );
			if ( $popup_id && 'newsletter' === $link_type ) {
				kubio_recommendation_set_click_promo_popup_triggers( $popup_id );
			}
		}

		if ( isset( $block['innerBlocks'] ) && ! empty( $block['innerBlocks'] ) ) {
			kubio_setup_click_promo_trigger_for_blocks( $block['innerBlocks'] );
		}
	}
}


add_filter(
	'kubio/rest-pre-save-post/import-assets',
	/**
	 * Filter to import assets when saving posts.
	 * @param \WP_Block[] $blocks The blocks to process.
	 */
	function ( $blocks ) {

		kubio_setup_click_promo_trigger_for_blocks( $blocks );

		return $blocks;
	}
);
