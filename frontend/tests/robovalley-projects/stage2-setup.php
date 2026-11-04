<?php
// RoboValley Projects: Stage 2 test data. LOCAL TEST SITE ONLY. Run: wp eval-file stage2-setup.php
// Creates temporary projects titled "RVPT ..." with unique MARKER strings in every restricted field, plus unpublished ones
// that must never be listed. Writes the markers and ids to wp-content/uploads/rvp-markers.json for the HTTP checks.
// Remove everything with stage2-teardown.php.

if ( ! defined( 'RVP_POST_TYPE' ) ) {
	WP_CLI::error( 'RoboValley Projects is not active.' );
}
if ( 'production' === wp_get_environment_type() ) {
	WP_CLI::error( 'Refusing to create test data in a production environment.' );
}

$tok = substr( md5( uniqid( '', true ) ), 0, 8 );
$m   = array(
	'overview'   => "RVPMARK_OVERVIEW_$tok zebra",
	'skills'     => "RVPMARK_SKILLS_$tok zebra",
	'components' => "RVPMARK_COMPONENTS_$tok zebra",
	'outcome'    => "RVPMARK_OUTCOME_$tok zebra",
	'subject'    => "RVPMARK_SUBJECT_$tok",
	'content'    => "RVPMARK_CONTENT_$tok",
	'excerpt'    => "RVPMARK_EXCERPT_$tok",
);

$subject = wp_insert_term( $m['subject'], RVP_TAX_SUBJECT );
$subject_id = is_wp_error( $subject ) ? 0 : $subject['term_id'];

// A tiny test image (flagged so stage2-teardown.php removes it), created here so the tests do not depend on the Media Library.
$image = get_posts( array( 'post_type' => 'attachment', 'meta_key' => '_rvp_test_image', 'meta_value' => '1', 'numberposts' => 1, 'post_status' => 'inherit', 'fields' => 'ids' ) );
$image_id = $image ? (int) $image[0] : 0;
if ( ! $image_id ) {
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$upload = wp_upload_dir();
	$file   = $upload['path'] . '/rvp-test-image-' . substr( md5( uniqid( '', true ) ), 0, 6 ) . '.png';
	file_put_contents( $file, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' ) );
	$image_id = wp_insert_attachment( array( 'post_mime_type' => 'image/png', 'post_title' => 'RVP TEST IMAGE', 'post_status' => 'inherit' ), $file );
	wp_update_attachment_metadata( $image_id, wp_generate_attachment_metadata( $image_id, $file ) );
	update_post_meta( $image_id, '_rvp_test_image', '1' );
}

$base = time() - 86400 * 40; // post dates: a fixed, distinct minute apart per project, so "latest" order is deterministic.
$n    = 0;
$make = function ( $title, $a = array() ) use ( &$n, $base, $m, $subject_id ) {
	$n++;
	$a += array(
		'status'     => 'publish',
		'desc'       => '',
		'tech'       => array(),
		'edu'        => array(),
		'difficulty' => '',
		'featured'   => false,
		'order'      => null,
		'restricted' => true,
		'thumb'      => 0,
		'password'   => '',
	);
	$post = array(
		'post_type'     => RVP_POST_TYPE,
		'post_title'    => $title,
		'post_status'   => $a['status'],
		'post_date'     => gmdate( 'Y-m-d H:i:s', $a['status'] === 'future' ? time() + 86400 * 365 : $base + $n * 60 ),
		'post_password' => $a['password'],
	);
	if ( $a['restricted'] ) {
		$post['post_content'] = $m['content'];
		$post['post_excerpt'] = $m['excerpt'];
	}
	$id = wp_insert_post( $post, true );
	if ( is_wp_error( $id ) ) {
		WP_CLI::error( $id->get_error_message() );
	}
	if ( 'future' === $a['status'] ) {
		wp_update_post( array( 'ID' => $id, 'post_status' => 'future', 'post_date' => $post['post_date'], 'post_date_gmt' => $post['post_date'], 'edit_date' => true ) );
	}
	update_post_meta( $id, '_rvp_short_desc', $a['desc'] );
	if ( $a['difficulty'] ) {
		update_post_meta( $id, '_rvp_difficulty', $a['difficulty'] );
	}
	if ( $a['featured'] ) {
		update_post_meta( $id, '_rvp_featured', '1' );
	}
	if ( null !== $a['order'] ) {
		update_post_meta( $id, '_rvp_order', (string) $a['order'] );
	}
	if ( $a['restricted'] ) {
		update_post_meta( $id, '_rvp_overview', $m['overview'] );
		update_post_meta( $id, '_rvp_skills', $m['skills'] );
		update_post_meta( $id, '_rvp_components', $m['components'] );
		update_post_meta( $id, '_rvp_outcome', $m['outcome'] );
		if ( $subject_id ) {
			wp_set_object_terms( $id, array( (int) $subject_id ), RVP_TAX_SUBJECT );
		}
	}
	wp_set_object_terms( $id, $a['tech'], RVP_TAX_TECH );
	wp_set_object_terms( $id, $a['edu'], RVP_TAX_EDU );
	if ( $a['thumb'] ) {
		set_post_thumbnail( $id, $a['thumb'] );
	}
	return $id;
};

$ids = array( 'published' => array(), 'unpublished' => array() );

// Specials (published).
$ids['published']['alpha'] = $make( 'RVPT Alpha Rover', array( 'desc' => 'Line follower with infrared sensors', 'tech' => array( 'robotics' ), 'edu' => array( 'class-6-10' ), 'difficulty' => 'beginner', 'featured' => true, 'order' => 1, 'thumb' => $image_id ) );
$ids['published']['beta']  = $make( 'RVPT Beta Flyer', array( 'desc' => 'Quadcopter flight controller', 'tech' => array( 'drone-technology' ), 'edu' => array( 'b-tech' ), 'difficulty' => 'advanced', 'featured' => true, 'order' => 2 ) );
$ids['published']['gamma'] = $make( 'RVPT Gamma Printer', array( 'desc' => 'Printable gear set with a unicorn logo', 'tech' => array( '3d-printing', 'electronics' ), 'edu' => array( 'iti', 'polytechnic' ), 'difficulty' => 'intermediate', 'order' => 0 ) );
$ids['published']['noorder'] = $make( 'RVPT Delta No Order', array( 'desc' => 'Has no display order at all', 'tech' => array( 'robotics' ), 'edu' => array( 'class-6-10', 'intermediate' ), 'difficulty' => 'beginner' ) );
$ids['published']['hidden_fields'] = $make( 'RVPT Hidden Fields Project', array( 'desc' => 'Public text only', 'tech' => array( 'iot' ), 'edu' => array( 'postgraduate' ), 'difficulty' => 'advanced' ) );
$ids['published']['pct'] = $make( 'RVPT Percent 100% _under_ it\'s', array( 'desc' => 'Literal % and _ and quote \' characters', 'tech' => array( 'stem' ), 'edu' => array( 'other' ), 'difficulty' => 'beginner', 'restricted' => false ) );

// Bulk (published): enough to test pagination and caps.
$techs = array( 'robotics', 'iot', 'stem', 'automation' );
$edus  = array( array( 'class-6-10' ), array( 'intermediate', 'iti' ), array( 'b-tech' ), array( 'polytechnic', 'postgraduate' ) );
$diffs = array( 'beginner', 'intermediate', 'advanced' );
for ( $i = 1; $i <= 30; $i++ ) {
	$ids['published'][ 'bulk' . $i ] = $make(
		sprintf( 'RVPT Bulk %02d', $i ),
		array(
			'desc'       => 'Bulk project number ' . $i,
			'tech'       => array( $techs[ $i % 4 ] ),
			'edu'        => $edus[ ( $i + 1 ) % 4 ],
			'difficulty' => $diffs[ $i % 3 ],
			'featured'   => 0 === $i % 5,
			'order'      => $i % 7,
		)
	);
}

// Unpublished: must never appear anywhere public. Titles are distinctive.
$ids['unpublished']['draft']   = $make( 'RVPT Hidden Draft', array( 'status' => 'draft', 'desc' => 'draft desc', 'tech' => array( 'robotics' ), 'featured' => true ) );
$ids['unpublished']['pending'] = $make( 'RVPT Hidden Pending', array( 'status' => 'pending', 'desc' => 'pending desc', 'tech' => array( 'robotics' ) ) );
$ids['unpublished']['private'] = $make( 'RVPT Hidden Private', array( 'status' => 'private', 'desc' => 'private desc', 'tech' => array( 'robotics' ) ) );
$ids['unpublished']['future']  = $make( 'RVPT Hidden Future', array( 'status' => 'future', 'desc' => 'future desc', 'tech' => array( 'robotics' ) ) );
$ids['unpublished']['password'] = $make( 'RVPT Hidden Password', array( 'desc' => 'password desc', 'tech' => array( 'robotics' ), 'password' => 'secret123' ) );

// One empty technology that the admin wants shown anyway.
$other = get_term_by( 'slug', 'other-technologies', RVP_TAX_TECH );
if ( $other ) {
	update_term_meta( $other->term_id, 'rvp_show_empty', 1 );
}

$out = array( 'markers' => $m, 'ids' => $ids, 'subject_term' => $subject_id, 'image_id' => $image_id );
$dir = wp_upload_dir();
file_put_contents( $dir['basedir'] . '/rvp-markers.json', wp_json_encode( $out ) );
WP_CLI::success( sprintf( 'Created %d published and %d unpublished test projects. Markers written to uploads/rvp-markers.json', count( $ids['published'] ), count( $ids['unpublished'] ) ) );
