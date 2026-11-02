<?php
use Kubio\Core\LodashBasic;


function kubio_is_fluent_booking_plugin_active() {
	if ( ! class_exists( '\Kubio\PluginsManager' ) ) {
		return false;
	}
	$manager = \Kubio\PluginsManager::getInstance();

	return $manager->isPluginActive( 'fluent-booking' );
}

function kubio_get_fluent_booking_events() {
	if ( ! kubio_is_fluent_booking_plugin_active() ) {
		return array();
	}
	if ( ! class_exists( '\FluentBooking\App\Models\CalendarSlot' ) ||
		! class_exists( '\FluentBooking\App\Models\Calendar' ) ||
		! method_exists( '\FluentBooking\App\Models\CalendarSlot', 'getTable' ) ||
		! method_exists( '\FluentBooking\App\Models\Calendar', 'getTable' )
	) {
		return array();
	}

	global $wpdb;
	$calendar_slot_model = new \FluentBooking\App\Models\CalendarSlot();
	$calendar_model      = new \FluentBooking\App\Models\Calendar();
	$calendar_slot_table = $wpdb->prefix . $calendar_slot_model->getTable();
	$calendar_table      = $wpdb->prefix . $calendar_model->getTable();

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, 	WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$calendars = $wpdb->get_results( "SELECT * FROM $calendar_table WHERE user_id = 1", ARRAY_A );

	if ( $calendars === false || ! is_array( $calendars ) || $wpdb->last_error ) {
		return array();
	}

	$calendar_id = LodashBasic::get( $calendars, '0.id' );

	if ( empty( $calendar_id ) ) {
		return array();
	}
	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, 	WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$events = $wpdb->get_results( "SELECT * FROM $calendar_slot_table WHERE calendar_id = $calendar_id", ARRAY_A );

	if ( $events === false || ! is_array( $events ) || $wpdb->last_error ) {
		return array();
	}

	$slots = array_map(
		function ( $event ) {
			return array(
				'label' => LodashBasic::get( $event, 'title' ),
				'value' => intval( LodashBasic::get( $event, 'id' ) ),
			);
		},
		$events
	);

	//We make sure we have the data we require
	$slots = array_filter(
		$slots,
		function ( $item ) {
			return LodashBasic::get( $item, 'value' ) !== null && LodashBasic::get( $item, 'label' ) !== null;
		}
	);
	return $slots;
}

function kubio_get_fluent_booking_calendar_id() {
	if ( ! kubio_is_fluent_booking_plugin_active() ) {
		return null;
	}

	if ( ! class_exists( '\FluentBooking\App\Models\Calendar' ) ) {
		return null;
	}

	ob_start();
	global $wpdb;
	$calendar_model = new \FluentBooking\App\Models\Calendar();
	$calendar_table = $wpdb->prefix . $calendar_model->getTable();

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, 	WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$calendars = $wpdb->get_results( "SELECT * FROM $calendar_table WHERE user_id = 1", OBJECT );

	$calendar_id = 1;
	if ( count( $calendars ) > 0 ) {
		$calendar_id = $calendars[0]->id;
	}

	$errors = ob_get_clean();

	return $calendar_id;
}
