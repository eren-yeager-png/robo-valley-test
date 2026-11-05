<?php
/**
 * Starter taxonomy terms. Runs once, on activation. It creates terms only (never projects), skips any term
 * whose slug already exists, never changes an existing term, and sets the display order only on terms it creates.
 * After the first run the option below is set, so terms an administrator deletes or renames are not brought back.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** taxonomy => list of slug => name, in display order. */
function rvp_seed_data() {
	return array(
		RVP_TAX_TECH    => array(
			'robotics'            => 'Robotics',
			'embedded-systems'    => 'Embedded Systems',
			'stem'                => 'STEM',
			'artificial-intelligence' => 'Artificial Intelligence',
			'iot'                 => 'IoT',
			'3d-printing'         => '3D Printing',
			'automation'          => 'Automation',
			'electronics'         => 'Electronics',
			'drone-technology'    => 'Drone Technology',
			'other-technologies'  => 'Other Technologies',
		),
		RVP_TAX_EDU     => array(
			'class-6-10'   => 'Class 6–10',
			'intermediate' => 'Intermediate',
			'iti'          => 'ITI',
			'polytechnic'  => 'Polytechnic',
			'b-tech'       => 'B.Tech',
			'postgraduate' => 'Postgraduate',
			'other'        => 'Other',
		),
		RVP_TAX_SUBJECT => array(
			'physics'                => 'Physics',
			'mathematics'            => 'Mathematics',
			'computer-science'       => 'Computer Science',
			'electronics'            => 'Electronics',
			'chemistry'              => 'Chemistry',
			'mechanical-engineering' => 'Mechanical Engineering',
			'electrical-engineering' => 'Electrical Engineering',
			'other'                  => 'Other',
		),
	);
}

function rvp_seed_terms() {
	if ( get_option( 'rvp_terms_seeded' ) ) {
		return;
	}
	foreach ( rvp_seed_data() as $taxonomy => $terms ) {
		if ( ! taxonomy_exists( $taxonomy ) ) {
			continue;
		}
		$position = 0;
		foreach ( $terms as $slug => $name ) {
			$position += 10;
			if ( get_term_by( 'slug', $slug, $taxonomy ) ) {
				continue;
			}
			$created = wp_insert_term( $name, $taxonomy, array( 'slug' => $slug ) );
			if ( ! is_wp_error( $created ) ) {
				add_term_meta( $created['term_id'], 'rvp_order', $position, true );
			}
		}
	}
	update_option( 'rvp_terms_seeded', RVP_VERSION, false );
}
