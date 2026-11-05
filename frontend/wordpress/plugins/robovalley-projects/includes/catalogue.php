<?php
/**
 * Public catalogue: query and output shaping.
 *
 * Everything here is PUBLIC output. Items are built from an explicit whitelist of public fields (title, short
 * description, image, technology, difficulty, education levels). The members-only fields (overview, skills,
 * components, outcome, subjects) are never read in this file. Search looks only at the title, the short description
 * and the technology / education term names.
 *
 * Every text value is returned as PLAIN TEXT (no markup, no HTML entities). Whoever renders it must use textContent
 * (or escape it), never innerHTML.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Largest page size a request may ask for. Bigger values are lowered to this. */
define( 'RVP_MAX_PER_PAGE', 24 );
/** Most project ids one request may pass in "include". */
define( 'RVP_MAX_INCLUDE', 200 );

/**
 * Runs the catalogue query.
 *
 * @param array $p Already sanitized parameters: search (string), technology (slugs), education (slugs),
 *                 difficulty (slugs), view (featured|latest|all), page, per_page, include (ids or null).
 * @return WP_Query
 */
function rvp_catalogue_query( array $p ) {
	$tax_query = array( 'relation' => 'AND' );
	foreach ( array( RVP_TAX_TECH => 'technology', RVP_TAX_EDU => 'education' ) as $taxonomy => $key ) {
		if ( ! empty( $p[ $key ] ) ) {
			$tax_query[] = array(
				'taxonomy' => $taxonomy,
				'field'    => 'slug',
				'terms'    => $p[ $key ],
				'operator' => 'IN',
			);
		}
	}

	$meta_query = array( 'relation' => 'AND' );
	if ( ! empty( $p['difficulty'] ) ) {
		$meta_query[] = array(
			'key'     => '_rvp_difficulty',
			'value'   => $p['difficulty'],
			'compare' => 'IN',
		);
	}
	if ( 'featured' === $p['view'] ) {
		$meta_query[] = array(
			'key'     => '_rvp_featured',
			'value'   => '1',
			'compare' => '=',
		);
	}

	$args = array(
		'post_type'              => RVP_POST_TYPE,
		'post_status'            => 'publish', // drafts, pending, private and scheduled projects are never listed.
		'posts_per_page'         => $p['per_page'],
		'paged'                  => $p['page'],
		'ignore_sticky_posts'    => true,
		'has_password'           => false,
		'update_post_meta_cache' => true,
		'update_post_term_cache' => true,
		'suppress_filters'       => false, // needed for the clauses filter below.
		'rvp_catalogue'          => array(
			'view'   => $p['view'],
			'search' => $p['search'],
		),
	);
	if ( count( $tax_query ) > 1 ) {
		$args['tax_query'] = $tax_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- small table, needed filter.
	}
	if ( count( $meta_query ) > 1 ) {
		$args['meta_query'] = $meta_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- small table, needed filter.
	}
	// SUBJECT FILTER HOOK (stage 3). Members filter by subject through the signed-in app route, which returns only
	// project ids; the page then passes them here. An empty list means "nothing matched" and must return nothing.
	// This is NOT a subject parameter: it carries ids only, and no subject data is read or returned here.
	if ( is_array( $p['include'] ) ) {
		$args['post__in'] = $p['include'] ? $p['include'] : array( 0 );
	}

	add_filter( 'posts_clauses', 'rvp_catalogue_clauses', 10, 2 );
	$query = new WP_Query( $args );
	remove_filter( 'posts_clauses', 'rvp_catalogue_clauses', 10 );

	if ( $query->posts ) {
		update_post_thumbnail_cache( $query );
	} elseif ( $p['page'] > 1 ) {
		// WordPress skips its row count for an empty page, so a page past the end would report a total of 0.
		// Count again from page 1 so the caller still gets the real total.
		add_filter( 'posts_clauses', 'rvp_catalogue_clauses', 10, 2 );
		$first = new WP_Query( array_merge( $args, array( 'paged' => 1, 'posts_per_page' => 1, 'fields' => 'ids' ) ) );
		remove_filter( 'posts_clauses', 'rvp_catalogue_clauses', 10 );
		$query->found_posts   = (int) $first->found_posts;
		$query->max_num_pages = (int) ceil( $query->found_posts / max( 1, (int) $p['per_page'] ) );
	}
	return $query;
}

/**
 * SQL for the catalogue query only (it does nothing for any other query): the search, and the sort order, which needs
 * a missing "display order" to count as 0.
 */
function rvp_catalogue_clauses( $clauses, $query ) {
	global $wpdb;
	$opts = $query->get( 'rvp_catalogue' );
	if ( ! is_array( $opts ) ) {
		return $clauses;
	}

	// Search: every word must match the title, the short description or a technology / education term name.
	$words = rvp_search_words( isset( $opts['search'] ) ? $opts['search'] : '' );
	foreach ( $words as $word ) {
		$like = '%' . $wpdb->esc_like( $word ) . '%';
		$clauses['where'] .= $wpdb->prepare(
			" AND ( {$wpdb->posts}.post_title LIKE %s"
			. " OR EXISTS ( SELECT 1 FROM {$wpdb->postmeta} rvp_sm WHERE rvp_sm.post_id = {$wpdb->posts}.ID AND rvp_sm.meta_key = '_rvp_short_desc' AND rvp_sm.meta_value LIKE %s )"
			. " OR EXISTS ( SELECT 1 FROM {$wpdb->term_relationships} rvp_tr"
			. " INNER JOIN {$wpdb->term_taxonomy} rvp_tt ON rvp_tt.term_taxonomy_id = rvp_tr.term_taxonomy_id"
			. " INNER JOIN {$wpdb->terms} rvp_t ON rvp_t.term_id = rvp_tt.term_id"
			. " WHERE rvp_tr.object_id = {$wpdb->posts}.ID AND rvp_tt.taxonomy IN ( %s, %s ) AND rvp_t.name LIKE %s ) )",
			$like,
			$like,
			RVP_TAX_TECH,
			RVP_TAX_EDU,
			$like
		);
	}

	// Order. A project without a display order counts as 0.
	$clauses['join'] .= $wpdb->prepare(
		" LEFT JOIN {$wpdb->postmeta} rvp_ord ON ( rvp_ord.post_id = {$wpdb->posts}.ID AND rvp_ord.meta_key = %s )",
		'_rvp_order'
	);
	$by_order = "CAST( COALESCE( rvp_ord.meta_value, '0' ) AS UNSIGNED )";
	switch ( isset( $opts['view'] ) ? $opts['view'] : 'all' ) {
		case 'latest':
			$clauses['orderby'] = "{$wpdb->posts}.post_date DESC, {$wpdb->posts}.ID DESC";
			break;
		case 'featured':
			$clauses['orderby'] = "$by_order ASC, {$wpdb->posts}.post_date DESC, {$wpdb->posts}.ID DESC";
			break;
		default:
			$clauses['orderby'] = "$by_order ASC, {$wpdb->posts}.post_title ASC, {$wpdb->posts}.ID ASC";
	}
	return $clauses;
}

/** Splits a search phrase into at most 6 words of at most 40 characters. */
function rvp_search_words( $search ) {
	$search = trim( (string) $search );
	if ( '' === $search ) {
		return array();
	}
	$words = preg_split( '/\s+/u', $search, -1, PREG_SPLIT_NO_EMPTY );
	$words = array_map(
		function ( $w ) {
			return mb_substr( $w, 0, 40 );
		},
		(array) $words
	);
	return array_slice( array_values( array_unique( $words ) ), 0, 6 );
}

/* ---------- Output shaping (public fields only) ---------- */

/** Text as plain text: tags removed, HTML entities decoded, whitespace tidied. */
function rvp_plain( $text ) {
	return trim( html_entity_decode( wp_strip_all_tags( (string) $text ), ENT_QUOTES, 'UTF-8' ) );
}

/** The public representation of one project. */
function rvp_public_project( WP_Post $post ) {
	$difficulty = (string) get_post_meta( $post->ID, '_rvp_difficulty', true );
	$levels     = rvp_difficulties();

	return array(
		'id'                => (int) $post->ID,
		'title'             => rvp_plain( $post->post_title ),
		'short_description' => (string) get_post_meta( $post->ID, '_rvp_short_desc', true ),
		'thumbnail'         => rvp_public_image( (int) get_post_thumbnail_id( $post ), 'medium_large', $post->post_title ),
		'technology'        => rvp_public_terms( $post->ID, RVP_TAX_TECH ),
		'difficulty'        => isset( $levels[ $difficulty ] ) ? array( 'slug' => $difficulty, 'label' => $levels[ $difficulty ] ) : null,
		'education'         => rvp_public_terms( $post->ID, RVP_TAX_EDU ),
	);
}

/** Terms of a taxonomy for a project, in display order, as slug + name. */
function rvp_public_terms( $post_id, $taxonomy ) {
	$terms = get_the_terms( $post_id, $taxonomy );
	if ( ! $terms || is_wp_error( $terms ) ) {
		return array();
	}
	usort( $terms, 'rvp_compare_terms' );
	$out = array();
	foreach ( $terms as $term ) {
		$out[] = array(
			'slug' => $term->slug,
			'name' => rvp_plain( $term->name ),
		);
	}
	return $out;
}

/** Sort by the "Display order" term field, then by name. */
function rvp_compare_terms( $a, $b ) {
	$order = (int) get_term_meta( $a->term_id, 'rvp_order', true ) - (int) get_term_meta( $b->term_id, 'rvp_order', true );
	return $order ? $order : strcasecmp( $a->name, $b->name );
}

/**
 * An image as url + real width/height (+ srcset when WordPress has one) + alt text, or null.
 * Uses a size WordPress already generates, so no new image size is added to the site.
 */
function rvp_public_image( $attachment_id, $size, $fallback_alt = '' ) {
	if ( ! $attachment_id ) {
		return null;
	}
	$src = wp_get_attachment_image_src( $attachment_id, $size );
	if ( ! $src ) {
		return null;
	}
	$alt = trim( (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true ) );
	$img = array(
		'url'    => $src[0],
		'width'  => (int) $src[1],
		'height' => (int) $src[2],
		'alt'    => rvp_plain( '' !== $alt ? $alt : $fallback_alt ),
	);
	$srcset = wp_get_attachment_image_srcset( $attachment_id, $size );
	if ( $srcset ) {
		$img['srcset'] = $srcset;
	}
	return $img;
}

/**
 * The technology list for the "Explore by Technology" section: name, slug, description, image, order, count.
 * Technologies without published projects are left out unless "Show even when it has no projects" is ticked.
 */
function rvp_technology_list() {
	$terms = get_terms(
		array(
			'taxonomy'   => RVP_TAX_TECH,
			'hide_empty' => false,
		)
	);
	if ( ! $terms || is_wp_error( $terms ) ) {
		return array();
	}
	$counts = rvp_technology_counts();
	$list   = array();
	foreach ( $terms as $term ) {
		$count = isset( $counts[ $term->term_id ] ) ? $counts[ $term->term_id ] : 0;
		if ( $count < 1 && ! get_term_meta( $term->term_id, 'rvp_show_empty', true ) ) {
			continue;
		}
		$list[] = $term;
	}
	usort( $list, 'rvp_compare_terms' );

	$out = array();
	foreach ( $list as $term ) {
		$out[] = array(
			'slug'        => $term->slug,
			'name'        => rvp_plain( $term->name ),
			'description' => rvp_plain( $term->description ),
			'image'       => rvp_public_image( (int) get_term_meta( $term->term_id, 'rvp_image_id', true ), 'medium', $term->name ),
			'order'       => (int) get_term_meta( $term->term_id, 'rvp_order', true ),
			'count'       => isset( $counts[ $term->term_id ] ) ? $counts[ $term->term_id ] : 0,
		);
	}
	return $out;
}

/**
 * Projects per technology, counted the same way the catalogue lists them: published and not password protected.
 * (WordPress's own term count also includes password-protected projects, which the catalogue never shows.)
 *
 * @return int[] term id => count
 */
function rvp_technology_counts() {
	global $wpdb;
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tt.term_id, COUNT( DISTINCT p.ID ) AS n
			FROM {$wpdb->term_relationships} tr
			INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = %s
			INNER JOIN {$wpdb->posts} p ON p.ID = tr.object_id AND p.post_type = %s AND p.post_status = 'publish' AND p.post_password = ''
			GROUP BY tt.term_id",
			RVP_TAX_TECH,
			RVP_POST_TYPE
		)
	);
	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[ (int) $row->term_id ] = (int) $row->n;
	}
	return $out;
}
