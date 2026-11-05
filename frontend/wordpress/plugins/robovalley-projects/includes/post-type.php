<?php
/**
 * The "Project" content type.
 *
 * It is deliberately NOT public: no front-end URL, no archive, no rewrite rules, no REST route, no search,
 * no sitemap or oEmbed entry. Projects are only shown through the plugin's own endpoints and the Projects page,
 * so nothing in a project can leak through WordPress's built-in output, and no existing URL can be affected.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rvp_register_post_type() {
	register_post_type(
		RVP_POST_TYPE,
		array(
			'labels'              => array(
				'name'               => __( 'Projects', 'robovalley-projects' ),
				'singular_name'      => __( 'Project', 'robovalley-projects' ),
				'menu_name'          => __( 'Projects', 'robovalley-projects' ),
				'all_items'          => __( 'All Projects', 'robovalley-projects' ),
				'add_new'            => __( 'Add New', 'robovalley-projects' ),
				'add_new_item'       => __( 'Add New Project', 'robovalley-projects' ),
				'edit_item'          => __( 'Edit Project', 'robovalley-projects' ),
				'new_item'           => __( 'New Project', 'robovalley-projects' ),
				'view_item'          => __( 'View Project', 'robovalley-projects' ),
				'search_items'       => __( 'Search Projects', 'robovalley-projects' ),
				'not_found'          => __( 'No projects found.', 'robovalley-projects' ),
				'not_found_in_trash' => __( 'No projects found in the Trash.', 'robovalley-projects' ),
				'featured_image'     => __( 'Project image', 'robovalley-projects' ),
				'set_featured_image' => __( 'Set project image', 'robovalley-projects' ),
				'remove_featured_image' => __( 'Remove project image', 'robovalley-projects' ),
				'use_featured_image' => __( 'Use as project image', 'robovalley-projects' ),
			),
			'public'              => false,
			'publicly_queryable'  => false,
			'exclude_from_search' => true,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_nav_menus'   => false,
			'show_in_admin_bar'   => false,
			'show_in_rest'        => false,
			'has_archive'         => false,
			'rewrite'             => false,
			'query_var'           => false,
			'can_export'          => true,
			'menu_position'       => 26,
			'menu_icon'           => 'dashicons-lightbulb',
			'supports'            => array( 'title', 'thumbnail' ),
			'capability_type'     => array( 'rv_project', 'rv_projects' ),
			'map_meta_cap'        => true,
		)
	);
}
add_action( 'init', 'rvp_register_post_type' );

// The project image is the featured image. Switch it on for this post type only if the theme has not already done so for all.
add_action(
	'after_setup_theme',
	function () {
		add_theme_support( 'post-thumbnails', array( RVP_POST_TYPE ) );
	},
	20
);

add_filter(
	'enter_title_here',
	function ( $text, $post ) {
		return ( $post && RVP_POST_TYPE === $post->post_type ) ? __( 'Project title', 'robovalley-projects' ) : $text;
	},
	10,
	2
);
