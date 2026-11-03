<?php

use Kubio\Core\LodashBasic;


function kubio_is_recommendation_contact_form_plugin_active() {
	return class_exists( '\WPCF7_ContactForm' );
}

function kubio_get_recommendation_contact_forms( $top_forms_ids = array() ) {
	if ( ! kubio_is_recommendation_contact_form_plugin_active() ) {
		return array();
	}

	if ( ! class_exists( '\WPCF7_ContactForm' ) || ! method_exists( '\WPCF7_ContactForm', 'find' ) ) {
		return array();
	}

	// Get all the forms registered with Contact Form 7
	$contact_forms = \WPCF7_ContactForm::find();

	if ( ! is_array( $contact_forms ) || empty( $contact_forms ) ) {
		return array();
	}

	$sample_form = LodashBasic::get( $contact_forms, '0' );

	if ( ! is_callable( array( $sample_form, 'title' ) ) || ! is_callable( array( $sample_form, 'id' ) ) ) {
		return array();
	}

	$forms = array();

	foreach ( $contact_forms as $form ) {
		$next_form = array(
			'label' => $form->title(),
			'value' => intval( $form->id() ),
		);

		$label = LodashBasic::get($next_form, 'label');
		$default_contact_form_title = kubio_recommendation_get_default_contact_form_title();
		if ( $label === $default_contact_form_title) {
			// If this form is in the top forms, we add it at the beginning of the array
			array_unshift( $forms, $next_form );
		} else {
			// Otherwise we add it at the end of the array
			$forms[] = $next_form;
		}
	}

	//We make sure we have the data we require
	$forms = array_filter(
		$forms,
		function ( $item ) {
			return LodashBasic::get( $item, 'value' ) !== null && LodashBasic::get( $item, 'label' ) !== null;
		}
	);

	return $forms;
}
function kubio_recommendation_get_default_contact_form_title() {
	return  __( 'Contact / Quotation Form 1', 'kubio' );
}

function kubio_recommendations_create_contact_form() {
	if ( ! kubio_is_recommendation_contact_form_plugin_active() ) {
		return false;
	}

	if ( ! class_exists( '\WPCF7_ContactForm' ) ) {
		return false;
	}
	if ( ! method_exists( '\WPCF7_ContactForm', 'get_template' ) ||
		! method_exists( '\WPCF7_ContactForm', 'set_properties' ) ||
		! method_exists( '\WPCF7_ContactForm', 'save' ) ||
		! method_exists( '\WPCF7_ContactForm', 'id' ) ||
		! method_exists( '\WPCF7', 'update_option' )

	) {
		wp_send_json_error( __( 'At least one of required functions is missing', 'kubio' ), 400 );
	}
	$contact_form = \WPCF7_ContactForm::get_template(
		array(
			'title' => kubio_recommendation_get_default_contact_form_title(),
		)
	);

	$default_template = '';

	ob_start();
	require __DIR__ . '/contact-forms/default-template.php';
	$default_template = ob_get_clean();

	if ( $default_template ) {
		$contact_form->set_properties(
			array(
				'form' => $default_template,
			)
		);
	}

	$contact_form->save();

	\WPCF7::update_option(
		'bulk_validate',
		array(
			'timestamp'     => time(),
			'version'       => WPCF7_VERSION,
			'count_valid'   => 1,
			'count_invalid' => 0,
		)
	);

	if ( is_wp_error( $contact_form ) ) {
		return false;
	}

	return $contact_form->id();
}
