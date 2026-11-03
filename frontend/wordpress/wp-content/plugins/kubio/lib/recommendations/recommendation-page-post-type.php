<?php
use Kubio\Core\Importer;

add_action(
	'init',
	function () {
		$recommendation_page_post_type = 'kubio_recommend_page';
		$args                          = array(
			'labels'                => __( 'Recommendation pages', 'kubio' ),
			'public'                => true,
			'has_archive'           => false,
			'rewrite'               => false,
			'show_in_rest'          => true,
			'show_in_menu'          => false,
			'show_in_nav_menus'     => false,
			'exclude_from_search'   => true,
			'supports'              => array( 'editor', 'custom-fields', 'slug', 'revisions' ),
			'rest_controller_class' => 'WP_REST_Posts_Controller',
			'map_meta_cap'          => true,
			'show_ui'               => true,
			'hierarchical'          => false,
		);

		register_post_type( $recommendation_page_post_type, $args );

		register_post_meta(
			$recommendation_page_post_type,
			'plugin_slug',
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);

		register_post_meta(
			$recommendation_page_post_type,
			'plugin_form_id',
			array(
				'type'          => 'integer',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);
	}
);
function kubio_import_recommendation_page_post_type_template( $override = false ) {
	$single_template = file_get_contents( KUBIO_ROOT_DIR . '/defaults/recommendations-templates/single-kubio_recommend_page.html' );

	Importer::createTemplate( 'single-kubio_recommend_page', $single_template, $override, 'kubio' );
}
function kubio_delete_recommend_page_for_plugin( $plugin_slug, $plugin_form_id ) {
	// get kubio_recommend_page posts with the plugin_slug and plugin_form_id
	$recommendation_page_posts = get_posts(
		array(
			'post_type'      => 'kubio_recommend_page',
			'posts_per_page' => -1,
			'meta_query'     => array(
				array(
					'key'     => 'plugin_slug',
					'value'   => $plugin_slug,
					'compare' => '=',
				),
				array(
					'key'     => 'plugin_form_id',
					'value'   => $plugin_form_id,
					'compare' => '=',
				),
			),
			'fields'         => 'ids', // Only get post IDs
		)
	);

	foreach ( $recommendation_page_posts as $recommendation_page_post_id ) {
		wp_delete_post( $recommendation_page_post_id, true );
	}
}

add_action(
	'delete_post',
	/**
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 */
	function ( $post_id, $post ) {

		$supported_post_types = array(
			class_exists( \WPCF7_ContactForm::class ) ? \WPCF7_ContactForm::post_type : 'wpcf7_contact_form',

		);
		if ( ! in_array( $post->post_type, $supported_post_types, true ) ) {
			return;
		}

		$plugin_slug = null;

		switch ( $post->post_type ) {
			case class_exists( \WPCF7_ContactForm::class ) ? \WPCF7_ContactForm::post_type : 'wpcf7_contact_form':
				$plugin_slug = 'contact-form-7';
				break;

		}

		kubio_delete_recommend_page_for_plugin(
			$plugin_slug,
			$post_id
		);
	},
	10,
	2
);

add_action(
	'fluent_booking/before_delete_calendar_event',
	function ( $calendar ) {
		kubio_delete_recommend_page_for_plugin(
			'fluent-booking',
			$calendar->id
		);
	}
);
