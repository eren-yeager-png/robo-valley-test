<?php

use IlluminateAgnostic\Arr\Support\Arr;
use Kubio\Core\LodashBasic;


function kubio_is_recommendation_newsletter_plugin_active() {
	if ( ! class_exists( '\Kubio\PluginsManager' ) ) {
		return false;
	}
	$manager = \Kubio\PluginsManager::getInstance();

	return $manager->isPluginActive( 'iconvert-promoter' );
}

function kubio_get_recommendation_newsletters() {
	if ( ! kubio_is_recommendation_newsletter_plugin_active() ) {
		return array();
	}

	$args = array(
		'post_type'      => 'cs-promo-popups',
		'posts_per_page' => - 1,
	);

	$query = new WP_Query( $args );

	if ( ! $query->have_posts() ) {
		return array();
	}

	$posts               = $query->posts;
	$ignored_popup_types = array(
		'inline-promotion-bar',
		'floating-bar',
	);

	$filtered_posts = array_filter(
		$posts,
		function ( $post ) use ( $ignored_popup_types ) {
			$popup_type = get_post_meta( $post->ID, 'popup_type', true );

			return ! in_array( $popup_type, $ignored_popup_types, true );
		}
	);

	$mapped = array();

	foreach ( $filtered_posts as $post ) {
		$mapped[] = array(
			'label' => $post->post_title,
			'value' => $post->ID,
		);
	}

	return $mapped;
}



function kubio_recommendation_set_click_promo_popup_triggers( $promoId ) {
	if ( empty( $promoId ) ) {
		return;
	}
	$identifier = kubio_recommendation_popup_get_click_popup_selector( $promoId );

	$metas = get_post_meta( $promoId, 'triggers', true );

	Arr::set( $metas, 'on-click.0', 'advanced' );
	Arr::set( $metas, 'on-click.checkbox', true );
	Arr::set( $metas, 'on-click.1', $identifier );

	//disable the page load popup when moving to on click
	//These disables are temporary until it gets fixed in the promo the issue with other condition + click condition
	Arr::set( $metas, 'page-load.checkbox', false );
	Arr::set( $metas, 'after-inactivity.checkbox', false );
	update_post_meta( $promoId, 'triggers', $metas );

	$isActive = get_post_meta( $promoId, 'active', true );
	if ( $isActive !== true ) {
		update_post_meta( $promoId, 'active', '1' );
	}
}

function kubio_recommendation_popup_get_click_popup_selector( $id ) {
	return "[data-kubio-email-capture-popup-$id]";
}


function kubio_recommendations_create_promo_popup( $popup_data ) {

	if ( ! class_exists( '\CSPromo\Core\Admin\PopupService' ) ||
		! method_exists( '\CSPromo\Core\Admin\PopupService', 'create' ) ) {
		return null;
	}

	if ( empty( $popup_data ) ) {
		return null;
	}

	$promo_type = LodashBasic::get( $popup_data, 'type' );
	if ( empty( $promo_type ) ) {
		return null;
	}

	$popup_settings = array(
		'promoType'    => 'simple-popup',
		'position'     => 'center#center',
		'effectsSides' =>
			array(
				'in'  => 'In',
				'out' => 'Out',
			),
		'animationIn'  => 'effectSliding#slideInDown',
		'animationOut' => 'effectSliding#slideOutDown',
	);

	$popup_data['name'] = __( 'Email capture popup 1', 'kubio' );

	$popup_by_click_id = \CSPromo\Core\Admin\PopupService::create( $popup_data, $popup_settings );

	add_post_meta(
		$popup_by_click_id,
		'kubio_recommendation_popup',
		true,
		true
	);

	return $popup_by_click_id;
}
