<?php
/**
 * Project fields (post meta).
 *
 * PUBLIC  (may be shown to every visitor): short description, difficulty, featured, display order.
 *         Technology and Education Levels are taxonomies and are public too.
 * RESTRICTED (members only): overview, skills, components, expected outcome. The Subjects taxonomy is members-only as well.
 *
 * Nothing is exposed through the REST API (show_in_rest = false) and the keys start with "_" so WordPress hides them
 * from the Custom Fields box. Every restricted value can only be read by the signed server-to-server endpoint
 * (added in a later stage) and by users who can edit the project.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Allowed difficulty values (slug => label). */
function rvp_difficulties() {
	return array(
		'beginner'     => __( 'Beginner', 'robovalley-projects' ),
		'intermediate' => __( 'Intermediate', 'robovalley-projects' ),
		'advanced'     => __( 'Advanced', 'robovalley-projects' ),
	);
}

/**
 * The field registry: meta key => settings.
 *   restricted  true for members-only fields
 *   max         maximum length in characters
 */
function rvp_meta_fields() {
	return array(
		'_rvp_short_desc'  => array( 'restricted' => false, 'max' => 200 ),
		'_rvp_difficulty'  => array( 'restricted' => false, 'max' => 20 ),
		'_rvp_featured'    => array( 'restricted' => false, 'max' => 1 ),
		'_rvp_order'       => array( 'restricted' => false, 'max' => 6 ),
		'_rvp_overview'    => array( 'restricted' => true, 'max' => 5000 ),
		'_rvp_skills'      => array( 'restricted' => true, 'max' => 2000 ),
		'_rvp_components'  => array( 'restricted' => true, 'max' => 2000 ),
		'_rvp_outcome'     => array( 'restricted' => true, 'max' => 3000 ),
	);
}

/** Keys of the restricted fields. */
function rvp_restricted_meta_keys() {
	return array_keys( array_filter( rvp_meta_fields(), function ( $f ) {
		return $f['restricted'];
	} ) );
}

/** Cleans one field value for storing. Unknown keys return an empty string. */
function rvp_sanitize_meta( $key, $value ) {
	$fields = rvp_meta_fields();
	if ( ! isset( $fields[ $key ] ) || ! is_scalar( $value ) ) {
		return '';
	}
	$value = (string) $value;
	switch ( $key ) {
		case '_rvp_difficulty':
			$value = sanitize_key( $value );
			return isset( rvp_difficulties()[ $value ] ) ? $value : '';
		case '_rvp_featured':
			return $value ? '1' : '';
		case '_rvp_order':
			return (string) absint( $value );
		case '_rvp_short_desc':
			$value = sanitize_text_field( $value ); // one line.
			break;
		default:
			$value = sanitize_textarea_field( $value ); // keeps line breaks, strips tags.
	}
	return mb_substr( $value, 0, $fields[ $key ]['max'] );
}

add_action(
	'init',
	function () {
		foreach ( rvp_meta_fields() as $key => $field ) {
			register_post_meta(
				RVP_POST_TYPE,
				$key,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => false, // never in the REST API.
					'sanitize_callback' => function ( $value ) use ( $key ) {
						return rvp_sanitize_meta( $key, $value );
					},
					'auth_callback'     => function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', $post_id );
					},
				)
			);
		}
	}
);
