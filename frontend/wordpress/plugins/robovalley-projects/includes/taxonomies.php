<?php
/**
 * Taxonomies: Technology Categories, Education Levels, Subjects.
 * Like the post type they are not public (no archive pages, no rewrite rules, no REST route).
 * They use checkbox lists in the editor (hierarchical = true) but are used flat; the Parent field is hidden in the admin.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rvp_register_taxonomies() {
	$common = array(
		'public'             => false,
		'publicly_queryable' => false,
		'show_ui'            => true,
		'show_in_menu'       => true,
		'show_in_nav_menus'  => false,
		'show_in_rest'       => false,
		'show_tagcloud'      => false,
		'show_admin_column'  => true,
		'hierarchical'       => true,
		'rewrite'            => false,
		'query_var'           => false,
		'capabilities'       => array(
			'manage_terms' => 'manage_rv_project_terms',
			'edit_terms'   => 'manage_rv_project_terms',
			'delete_terms' => 'manage_rv_project_terms',
			'assign_terms' => 'edit_rv_projects',
		),
	);

	register_taxonomy(
		RVP_TAX_TECH,
		RVP_POST_TYPE,
		array_merge(
			$common,
			array(
				'labels' => array(
					'name'          => __( 'Technology Categories', 'robovalley-projects' ),
					'singular_name' => __( 'Technology Category', 'robovalley-projects' ),
					'menu_name'     => __( 'Technology Categories', 'robovalley-projects' ),
					'all_items'     => __( 'All Technology Categories', 'robovalley-projects' ),
					'add_new_item'  => __( 'Add New Technology Category', 'robovalley-projects' ),
					'edit_item'     => __( 'Edit Technology Category', 'robovalley-projects' ),
					'search_items'  => __( 'Search Technology Categories', 'robovalley-projects' ),
					'not_found'     => __( 'No technology categories found.', 'robovalley-projects' ),
				),
			)
		)
	);

	register_taxonomy(
		RVP_TAX_EDU,
		RVP_POST_TYPE,
		array_merge(
			$common,
			array(
				'labels' => array(
					'name'          => __( 'Education Levels', 'robovalley-projects' ),
					'singular_name' => __( 'Education Level', 'robovalley-projects' ),
					'menu_name'     => __( 'Education Levels', 'robovalley-projects' ),
					'all_items'     => __( 'All Education Levels', 'robovalley-projects' ),
					'add_new_item'  => __( 'Add New Education Level', 'robovalley-projects' ),
					'edit_item'     => __( 'Edit Education Level', 'robovalley-projects' ),
					'search_items'  => __( 'Search Education Levels', 'robovalley-projects' ),
					'not_found'     => __( 'No education levels found.', 'robovalley-projects' ),
				),
			)
		)
	);

	register_taxonomy(
		RVP_TAX_SUBJECT,
		RVP_POST_TYPE,
		array_merge(
			$common,
			array(
				'labels' => array(
					'name'          => __( 'Subjects', 'robovalley-projects' ),
					'singular_name' => __( 'Subject', 'robovalley-projects' ),
					'menu_name'     => __( 'Subjects', 'robovalley-projects' ),
					'all_items'     => __( 'All Subjects', 'robovalley-projects' ),
					'add_new_item'  => __( 'Add New Subject', 'robovalley-projects' ),
					'edit_item'     => __( 'Edit Subject', 'robovalley-projects' ),
					'search_items'  => __( 'Search Subjects', 'robovalley-projects' ),
					'not_found'     => __( 'No subjects found.', 'robovalley-projects' ),
				),
			)
		)
	);
}
add_action( 'init', 'rvp_register_taxonomies' );
