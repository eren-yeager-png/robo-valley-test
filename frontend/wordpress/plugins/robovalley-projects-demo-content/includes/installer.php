<?php
/**
 * Install and remove the sample projects. Everything created carries post meta _rvp_demo = 1; removal deletes only what carries it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True when the main plugin is active and its post type and taxonomies exist. (This plugin loads before it, so check late, never at load time.) */
function rvpdc_main_plugin_ready() {
	return defined( 'RVP_VERSION' ) && defined( 'RVP_POST_TYPE' ) && post_type_exists( RVP_POST_TYPE )
		&& taxonomy_exists( RVP_TAX_TECH ) && taxonomy_exists( RVP_TAX_EDU ) && taxonomy_exists( RVP_TAX_SUBJECT );
}

function rvpdc_statuses() {
	return array( 'publish', 'draft', 'pending', 'private', 'future', 'trash' );
}

/** IDs of every project that carries the demo tag (any status, including the Trash). */
function rvpdc_project_ids() {
	if ( ! defined( 'RVP_POST_TYPE' ) ) {
		return array();
	}
	return array_map( 'intval', get_posts( array(
		'post_type'      => RVP_POST_TYPE,
		'post_status'    => rvpdc_statuses(),
		'meta_key'       => '_rvp_demo',
		'meta_value'     => '1',
		'fields'         => 'ids',
		'posts_per_page' => -1,
		'no_found_rows'  => true,
		'orderby'        => 'ID',
		'order'          => 'ASC',
	) ) );
}

/** IDs of the Media Library images this plugin imported (tagged _rvp_demo = 1). */
function rvpdc_attachment_ids() {
	return array_map( 'intval', get_posts( array(
		'post_type'      => 'attachment',
		'post_status'    => 'any',
		'meta_key'       => '_rvp_demo',
		'meta_value'     => '1',
		'fields'         => 'ids',
		'posts_per_page' => -1,
		'no_found_rows'  => true,
		'orderby'        => 'ID',
		'order'          => 'ASC',
	) ) );
}

/** The demo project with this dataset key, or 0. */
function rvpdc_find_by_key( $key ) {
	$ids = get_posts( array(
		'post_type'      => RVP_POST_TYPE,
		'post_status'    => rvpdc_statuses(),
		'meta_query'     => array(
			array( 'key' => '_rvp_demo', 'value' => '1' ),
			array( 'key' => '_rvp_demo_key', 'value' => $key ),
		),
		'fields'         => 'ids',
		'posts_per_page' => 1,
		'no_found_rows'  => true,
	) );
	return $ids ? (int) $ids[0] : 0;
}

/** Existing term ids for these slugs. Missing slugs are returned separately and never created. */
function rvpdc_resolve_terms( $taxonomy, array $slugs ) {
	$ids     = array();
	$missing = array();
	foreach ( $slugs as $slug ) {
		$term = get_term_by( 'slug', $slug, $taxonomy );
		if ( $term && ! is_wp_error( $term ) ) {
			$ids[] = (int) $term->term_id;
		} else {
			$missing[] = $taxonomy . ':' . $slug;
		}
	}
	return array( $ids, $missing );
}

/** Imports assets/images/<key>.png into the Media Library, tagged as demo. Returns the attachment id or a WP_Error. */
function rvpdc_import_image( $item, $project_id ) {
	// an image this plugin imported earlier for this key (e.g. its project was deleted by hand) is reused, not duplicated
	$existing = get_posts( array(
		'post_type'      => 'attachment',
		'post_status'    => 'any',
		'meta_query'     => array(
			array( 'key' => '_rvp_demo', 'value' => '1' ),
			array( 'key' => '_rvp_demo_key', 'value' => $item['key'] ),
		),
		'fields'         => 'ids',
		'posts_per_page' => 1,
		'no_found_rows'  => true,
	) );
	if ( $existing ) {
		wp_update_post( array( 'ID' => (int) $existing[0], 'post_parent' => (int) $project_id ) );
		return (int) $existing[0];
	}
	$source = RVPDC_DIR . 'assets/images/' . $item['key'] . '.png';
	if ( ! is_readable( $source ) ) {
		return new WP_Error( 'rvpdc_no_image', 'Image file missing: ' . $item['key'] . '.png' );
	}
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$tmp = wp_tempnam( $item['key'] . '.png' );
	if ( ! $tmp || ! copy( $source, $tmp ) ) {
		return new WP_Error( 'rvpdc_copy', 'Could not copy the image to a temporary file.' );
	}
	$id = media_handle_sideload(
		array( 'name' => $item['key'] . '.png', 'tmp_name' => $tmp ),
		$project_id,
		$item['title'],
		array( 'post_title' => $item['title'] . ' (demo thumbnail)', 'post_excerpt' => '', 'post_content' => '' )
	);
	if ( is_wp_error( $id ) ) {
		if ( file_exists( $tmp ) ) {
			@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		return $id;
	}
	update_post_meta( $id, '_wp_attachment_image_alt', $item['title'] . ': illustration with a simple icon for the ' . $item['tech_label'] . ' topic' );
	update_post_meta( $id, '_rvp_demo', '1' );
	update_post_meta( $id, '_rvp_demo_key', $item['key'] );
	return (int) $id;
}

/** Asks the catalogue cache to refresh (LiteSpeed, through the main plugin's own hook and tag). Does nothing without LiteSpeed. */
function rvpdc_purge() {
	if ( function_exists( 'rvp_purge_catalogue_cache' ) ) {
		rvp_purge_catalogue_cache();
	}
	do_action( 'litespeed_purge', 'rvp_catalogue' );
}

/**
 * Creates the sample projects that do not exist yet. Idempotent: a project whose dataset key already exists is left exactly as it is.
 *
 * @return array|WP_Error created / skipped / images / missing_terms / errors
 */
function rvpdc_install() {
	if ( ! rvpdc_main_plugin_ready() ) {
		return new WP_Error( 'rvpdc_main', 'The RoboValley Projects plugin is not active.' );
	}
	$result = array( 'created' => 0, 'skipped' => 0, 'images' => 0, 'remaining' => 0, 'missing_terms' => array(), 'errors' => array() );
	// Importing 20 images can take longer than a web server allows for one request. Stop cleanly before the limit and say so; clicking
	// Install again carries on (projects that exist are skipped, so nothing is duplicated).
	$limit = (int) ini_get( 'max_execution_time' ); // 0 = unlimited (WP-CLI)
	if ( 0 !== $limit && function_exists( 'set_time_limit' ) && @set_time_limit( 180 ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, Squiz.PHP.DiscouragedFunctions.Discouraged
		$limit = 180;
	}
	$budget = apply_filters( 'rvpdc_time_budget', $limit > 0 ? max( 0, (int) floor( $limit * 0.6 ) ) : 600 );
	$start  = microtime( true );
	$made   = 0;
	$labels = array();
	foreach ( get_terms( array( 'taxonomy' => RVP_TAX_TECH, 'hide_empty' => false ) ) as $t ) {
		$labels[ $t->slug ] = $t->name;
	}
	$now = current_time( 'timestamp' ); // phpcs:ignore WordPress.DateTime.CurrentTimeTimestamp.Requested

	foreach ( rvpdc_dataset() as $item ) {
		if ( rvpdc_find_by_key( $item['key'] ) ) {
			$result['skipped']++;
			continue;
		}
		if ( $made > 0 && ( microtime( true ) - $start ) >= $budget ) {
			$result['remaining']++; // out of time for this request: left for the next click.
			continue;
		}
		$item['tech_label'] = isset( $labels[ $item['tech'] ] ) ? $labels[ $item['tech'] ] : $item['tech'];
		$stamp              = $now - $item['days_ago'] * DAY_IN_SECONDS;
		$id                 = wp_insert_post(
			array(
				'post_type'     => RVP_POST_TYPE,
				'post_status'   => 'publish',
				'post_title'    => $item['title'], // clean title: no "DEMO" prefix on the public site.
				'post_author'   => get_current_user_id(),
				'post_date'     => gmdate( 'Y-m-d H:i:s', $stamp ),
				'post_date_gmt' => get_gmt_from_date( gmdate( 'Y-m-d H:i:s', $stamp ) ),
			),
			true
		);
		if ( is_wp_error( $id ) || ! $id ) {
			$result['errors'][] = $item['title'] . ': ' . ( is_wp_error( $id ) ? $id->get_error_message() : 'could not be created' );
			continue;
		}
		// tag first, so even a half-finished project can be found and removed
		update_post_meta( $id, '_rvp_demo', '1' );
		update_post_meta( $id, '_rvp_demo_key', $item['key'] );
		update_post_meta( $id, '_rvp_short_desc', $item['desc'] );
		update_post_meta( $id, '_rvp_difficulty', $item['difficulty'] );
		update_post_meta( $id, '_rvp_order', (string) $item['order'] );
		if ( $item['featured'] ) {
			update_post_meta( $id, '_rvp_featured', '1' );
		}
		update_post_meta( $id, '_rvp_overview', $item['overview'] );
		update_post_meta( $id, '_rvp_skills', implode( "\n", $item['skills'] ) );
		update_post_meta( $id, '_rvp_components', implode( "\n", $item['components'] ) );
		update_post_meta( $id, '_rvp_outcome', $item['outcome'] );

		foreach ( array(
			array( RVP_TAX_TECH, array( $item['tech'] ) ),
			array( RVP_TAX_EDU, $item['edu'] ),
			array( RVP_TAX_SUBJECT, $item['subjects'] ),
		) as $pair ) {
			list( $ids, $missing ) = rvpdc_resolve_terms( $pair[0], $pair[1] );
			if ( $ids ) {
				wp_set_object_terms( $id, $ids, $pair[0] );
			}
			foreach ( $missing as $m ) {
				$result['missing_terms'][ $m ] = true; // reported, never created.
			}
		}

		$image = rvpdc_import_image( $item, $id );
		if ( is_wp_error( $image ) ) {
			$result['errors'][] = $item['title'] . ' (image): ' . $image->get_error_message();
		} else {
			set_post_thumbnail( $id, $image );
			$result['images']++;
		}
		$result['created']++;
		$made++;
	}
	$result['missing_terms'] = array_keys( $result['missing_terms'] );
	rvpdc_purge();
	return $result;
}

/**
 * Deletes ONLY the projects and images that carry _rvp_demo = 1. Each id is re-checked immediately before it is deleted.
 *
 * @return array|WP_Error projects / images / errors
 */
function rvpdc_remove() {
	if ( ! rvpdc_main_plugin_ready() ) {
		return new WP_Error( 'rvpdc_main', 'The RoboValley Projects plugin is not active.' );
	}
	$result = array( 'projects' => 0, 'images' => 0, 'errors' => array() );
	foreach ( rvpdc_project_ids() as $id ) {
		if ( RVP_POST_TYPE !== get_post_type( $id ) || '1' !== (string) get_post_meta( $id, '_rvp_demo', true ) ) {
			continue;
		}
		if ( wp_delete_post( $id, true ) ) {
			$result['projects']++;
		} else {
			$result['errors'][] = 'Project ' . $id . ' could not be deleted.';
		}
	}
	foreach ( rvpdc_attachment_ids() as $id ) {
		if ( 'attachment' !== get_post_type( $id ) || '1' !== (string) get_post_meta( $id, '_rvp_demo', true ) ) {
			continue;
		}
		if ( wp_delete_attachment( $id, true ) ) {
			$result['images']++;
		} else {
			$result['errors'][] = 'Image ' . $id . ' could not be deleted.';
		}
	}
	rvpdc_purge();
	return $result;
}
