<?php

use IlluminateAgnostic\Arr\Support\Arr;
use \Kubio\Flags;
use Kubio\Core\LodashBasic;

add_action(
	'rest_api_init',
	function () {
		$namespace = 'kubio/v1';

		register_rest_route(
			$namespace,
			'/prepare_siteleads_plugin',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_prepare_siteleads_plugin',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/get_siteleads_widgets',
			array(
				'methods'             => 'GET',
				'callback'            => 'kubio_api_get_siteleads_widgets',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/update_siteleads_widget_data',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_update_siteleads_widget_data',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);

		register_rest_route(
			$namespace,
			'/toggle_enable_siteleads_widget',
			array(
				'methods'             => 'POST',
				'callback'            => 'kubio_api_toggle_enable_siteleads_widget',
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},

			)
		);
	}
);



function kubio_api_prepare_siteleads_plugin( WP_REST_Request $request ) {

	if(!kubio_is_siteleads_plugin_active()) {
		wp_send_json_error(__( 'Required plugin is missing', 'kubio' ), 400);
	}
	if ( ! class_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'createDefaultWidgetWithOnlyPhoneChannel' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'createDefaultWidgetWithOnlyWhatsappChanel' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'createDefaultWidgetWithPhoneWhatsappAndEmail' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'getDefaultWidgetAlreadyCreated' )
	) {
		wp_send_json_error(__( 'Required class or functions are missing', 'kubio' ), 400);

	}

	$type = sanitize_text_field( $request->get_param( 'type' ) );

	$allowed = array( 'phone', 'whatsapp', 'phoneWhatsappEmail' );

	if ( ! in_array( $type, $allowed, true ) ) {
		wp_send_json_error(__( 'Invalid widget type.', 'kubio' ), 400);

	}

	//in case of failures only try init once
	$already_setup = Flags::getSetting( 'siteleadsInstalled', null );


	if ( $already_setup ) {
		wp_send_json_success(kubio_get_siteleads_widgets());
	}
	Flags::setSetting( "siteleadsInstalled", true );
	try {

		$site_leads_inited = \SiteLeads\Features\Widgets\FCWidgetsManager::getDefaultWidgetAlreadyCreated();
		$widgets = kubio_get_siteleads_widgets();
		//in case the widgets are already created return those
		if(!empty($widgets)) {
			wp_send_json_success($widgets);
		}
		$start_source = sanitize_text_field($request->get_param( 'start_source' ) );
		$options = [];
		if(!empty($start_source) && is_string($start_source)) {
			$options['start_source'] = $start_source;
		}


		//if siteleads was inited already skip this
		if(!$site_leads_inited) {
			Flags::set('siteLeadsInitedFromKubio', true);
			switch ($type) {
				case 'phone':
					\SiteLeads\Features\Widgets\FCWidgetsManager::createDefaultWidgetWithOnlyPhoneChannel('',$options);
					break;
				case 'whatsapp':
					\SiteLeads\Features\Widgets\FCWidgetsManager::createDefaultWidgetWithOnlyWhatsappChanel('',$options);
					break;
				case 'phoneWhatsappEmail':
					\SiteLeads\Features\Widgets\FCWidgetsManager::createDefaultWidgetWithPhoneWhatsappAndEmail($options);
			}
		}

		$result = kubio_get_siteleads_widgets();

		wp_send_json_success($result);

	} catch ( Exception $e ) {
		wp_send_json_error($e->getMessage(), 400);

	}
}


function kubio_api_get_siteleads_widgets( WP_REST_Request $request ) {
	wp_send_json_success(kubio_get_siteleads_widgets());
}


function kubio_api_update_siteleads_widget_data( WP_REST_Request $request ) {
	if(!kubio_is_siteleads_plugin_active()) {

		wp_send_json_error(__( 'Required plugin is missing', 'kubio' ), 400);
	}
	if ( ! class_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'updateWidgetPhoneNumberAfterCreation' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'updateWidgetWhatsappNumberAfterCreation' )
	) {

		wp_send_json_error(__( 'Required class or functions are missing', 'kubio' ), 400);
	}

	$site_leads_inited_from_kubio = Flags::get('siteLeadsInitedFromKubio');

	//if SiteLeads was inited from another product don't sync phone data
	if(!$site_leads_inited_from_kubio) {
		wp_send_json_success( true );
	}
	$widgetId = sanitize_text_field( $request->get_param( 'widgetId' ) );

	if ( empty( $widgetId ) ) {
		wp_send_json_error(__( 'Invalid widget ID', 'kubio' ), 400);
	}
	$params = $request->get_param( 'params' );

	if ( ! is_array( $params ) ) {
		wp_send_json_error(__( 'Invalid params format', 'kubio' ), 400);
	}
	try {


		$isPhoneType = LodashBasic::has($params, 'phone');

		$isWhatsappType = LodashBasic::has($params, 'whatsapp');
		$phoneNr = sanitize_text_field(
			LodashBasic::get( $params, 'phone.phoneNr', '' )
		);

		$whatsappNr = sanitize_text_field(
			LodashBasic::get( $params, 'whatsapp.phoneNr', '' )
		);

		if($isPhoneType && !Flags::get('siteLeadsPhoneUpdatedFromKubio')) {
			\SiteLeads\Features\Widgets\FCWidgetsManager::updateWidgetPhoneNumberAfterCreation($widgetId, $phoneNr );
			Flags::set('siteLeadsPhoneUpdatedFromKubio', true);
		}
		if($isWhatsappType && !Flags::get('siteLeadsWhatsappUpdatedFromKubio')) {
			\SiteLeads\Features\Widgets\FCWidgetsManager::updateWidgetWhatsappNumberAfterCreation($widgetId, $whatsappNr );
			Flags::set('siteLeadsWhatsappUpdatedFromKubio', true);
		}

		wp_send_json_success( true );

	} catch ( Exception $e ) {

		wp_send_json_error($e->getMessage(), 400);

	}
}


function kubio_api_toggle_enable_siteleads_widget( WP_REST_Request $request )
{
	if (!kubio_is_siteleads_plugin_active()) {

		wp_send_json_error(__( 'Required plugin is missing', 'kubio' ), 400);
	}
	if ( ! class_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager' ) ||
		! method_exists( '\SiteLeads\Features\Widgets\FCWidgetsManager', 'toggleWidgetEnabled' )
	) {
		wp_send_json_error(__( 'Required class or functions are missing', 'kubio' ), 400);

	}

	$widget_id = sanitize_text_field( $request->get_param( 'widgetId' ) );

	if ( empty( $widget_id ) ) {

		wp_send_json_error(__( 'Missing widgetId parameter.', 'kubio' ), 400);
	}


	$enabled = rest_sanitize_boolean( $request->get_param( 'enabled' ) );

	if ( ! $request->has_param( 'enabled' ) ) {
		wp_send_json_error(__( 'Missing enabled parameter.', 'kubio' ), 400);
	}
	try {

		\SiteLeads\Features\Widgets\FCWidgetsManager::toggleWidgetEnabled($widget_id, $enabled);

		wp_send_json_success( true );
	}
	catch(\Exception $e) {
		wp_send_json_error($e->getMessage(), 400);

	}
}
