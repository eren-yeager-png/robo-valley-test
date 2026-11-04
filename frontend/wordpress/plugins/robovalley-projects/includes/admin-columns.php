<?php
/**
 * "All Projects" list: difficulty, featured and order columns.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter(
	'manage_' . RVP_POST_TYPE . '_posts_columns',
	function ( $columns ) {
		$columns['rvp_difficulty'] = __( 'Difficulty', 'robovalley-projects' );
		$columns['rvp_featured']   = __( 'Featured', 'robovalley-projects' );
		$columns['rvp_order']      = __( 'Order', 'robovalley-projects' );
		unset( $columns['taxonomy-' . RVP_TAX_SUBJECT] ); // keeps the table narrow; subjects are members-only anyway.
		return $columns;
	}
);

add_action(
	'manage_' . RVP_POST_TYPE . '_posts_custom_column',
	function ( $column, $post_id ) {
		switch ( $column ) {
			case 'rvp_difficulty':
				$value = (string) get_post_meta( $post_id, '_rvp_difficulty', true );
				$list  = rvp_difficulties();
				echo esc_html( isset( $list[ $value ] ) ? $list[ $value ] : '—' );
				break;
			case 'rvp_featured':
				echo get_post_meta( $post_id, '_rvp_featured', true ) ? esc_html__( 'Yes', 'robovalley-projects' ) : '—';
				break;
			case 'rvp_order':
				echo esc_html( (string) (int) get_post_meta( $post_id, '_rvp_order', true ) );
				break;
		}
	},
	10,
	2
);
