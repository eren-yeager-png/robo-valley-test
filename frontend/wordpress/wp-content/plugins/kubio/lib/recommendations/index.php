<?php
use Kubio\Flags;


require_once __DIR__ . '/recommendations-trait.php';
require_once __DIR__ . '/contact-forms.php';
require_once __DIR__ . '/newsletters.php';
require_once __DIR__ . '/fluent-booking.php';
require_once __DIR__ . '/siteleads.php';
require_once __DIR__ . '/recommendation-page-post-type.php';

function kubio_get_recommendations_settings() {
	return array(
		'contactForm'   => array(
			'pluginIsActive' => kubio_is_recommendation_contact_form_plugin_active(),
			'inited'         => Flags::getSetting( 'contactFormsInstalled', false ),
			'itemsList'      => array(),
		),
		'newsletters'   => array(
			'pluginIsActive' => kubio_is_recommendation_newsletter_plugin_active(),
			'inited'         => Flags::getSetting( 'newslettersInstalled', false ),
			'itemsList'      => array(),
		),
		'fluentBooking' => array(
			'pluginIsActive' => kubio_is_fluent_booking_plugin_active(),
			'inited'         => Flags::getSetting( 'fluentBookingInstalled', false ),
			'itemsList'      => array(),
		),
		'siteleads'    => array(
			'proIsInstalled' => kubio_is_siteleads_pro_plugin_installed(),
			'pluginIsActive' => kubio_is_siteleads_plugin_active(),
			'pluginIsInstalled' => kubio_is_siteleads_plugin_installed(),
			'inited'         => Flags::getSetting( 'siteleadsInstalled', false ),
			'itemsList'      => kubio_get_siteleads_widgets(),
			'previewNonce' => wp_create_nonce( 'events_nonce' ),
		),
	);
}
add_filter(
	'kubio/kubio-utils-data/extras',
	function ( $utils_data ) {

		$utils_data['recommendations'] = isset( $utils_data['recommendations'] ) ? $utils_data['recommendations'] : array();

		$utils_data['recommendations'] = array_merge(
			$utils_data['recommendations'],
			array(
				'displayButtonActionsOptions' => true,
			)
		);

		return $utils_data;
	}
);

//add_action(
//	'kubio/after_activation',
//	function () {
//		Flags::setSetting( 'displayButtonActionsOptions', true );
//	}
//);


add_action(
	'after_switch_theme',
	function () {
		kubio_import_recommendation_page_post_type_template( false );
	}
);
