<?php
/**
 * The Projects page: the shortcode [robovalley_projects], its per-page flag and its assets.
 *
 * What the server renders is PUBLIC data only (the first page of cards with thumbnail, title, short description, technology,
 * difficulty and education levels, the technology tiles and the education/difficulty filters), so the page is the same for every
 * visitor and safe to cache. Nothing members-only is ever in this HTML: not the subject list, not the project details.
 * The script (assets/rvp-projects-page.js) adds search, filters, tabs, "Load more" and the two windows (sign-in prompt and
 * project details).
 *
 * The stylesheet and script load only on a page that has the flag (post meta "robovalley_projects") or that renders the shortcode.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RVP_PAGE_FLAG', 'robovalley_projects' );
define( 'RVP_PAGE_PER_PAGE', 12 );

/** Per-page opt-in flag (the same pattern as the Landing plugin's flag). Editable through the REST API by users who can edit the page. */
add_action(
	'init',
	function () {
		register_post_meta(
			'page',
			RVP_PAGE_FLAG,
			array(
				'type'          => 'boolean',
				'single'        => true,
				'default'       => false,
				'show_in_rest'  => true,
				'auth_callback' => function ( $allowed, $meta_key, $post_id ) {
					return current_user_can( 'edit_post', $post_id );
				},
			)
		);
	}
);

function rvp_page_is_flagged() {
	return is_singular( 'page' ) && (bool) get_post_meta( get_queried_object_id(), RVP_PAGE_FLAG, true );
}

/** Not inside Elementor's editor or preview, where scripts that rewrite the page confuse the editor. */
function rvp_page_is_elementor_editing() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only flag check.
	if ( isset( $_GET['elementor-preview'] ) ) {
		return true;
	}
	if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance ) ) {
		$e = \Elementor\Plugin::$instance;
		return ( isset( $e->preview ) && $e->preview->is_preview_mode() ) || ( isset( $e->editor ) && $e->editor->is_edit_mode() );
	}
	return false;
}

/** Address of the RoboValley app (sign-in and sign-up live there). The same option / filter the rest of the site already uses. */
function rvp_app_base() {
	$base = apply_filters( 'robovalley_api_base', get_option( 'robovalley_api_base', '' ) );
	$base = is_string( $base ) ? esc_url_raw( trim( $base ), array( 'http', 'https' ) ) : '';
	return untrailingslashit( $base );
}

/** This page's own address (used to build the "come back to this project" address for sign-in). */
function rvp_page_url() {
	$id = get_queried_object_id();
	return $id ? get_permalink( $id ) : home_url( '/' );
}

/** Sign-in / sign-up address in the app, with a returnTo that brings the visitor back to a project (the app validates it). */
function rvp_page_auth_url( $path, $project_id = 0 ) {
	$base = rvp_app_base();
	if ( '' === $base ) {
		return '';
	}
	$back = $project_id > 0 ? add_query_arg( 'project', (int) $project_id, rvp_page_url() ) : rvp_page_url();
	return $base . $path . '?returnTo=' . rawurlencode( $back );
}

/**
 * Loads the stylesheet and script once. Fonts: the Landing plugin's self-hosted fonts are reused only when that plugin is active
 * and its file exists; otherwise the CSS falls back to the system font stack.
 */
function rvp_page_enqueue() {
	static $done = false;
	if ( $done || rvp_page_is_elementor_editing() ) {
		return;
	}
	$done = true;

	$deps = array();
	$font = WP_PLUGIN_DIR . '/robovalley-landing/assets/robovalley-fonts.css';
	if ( defined( 'ROBOVALLEY_LANDING_VERSION' ) && is_readable( $font ) ) {
		wp_enqueue_style( 'rvp-projects-fonts', WP_PLUGIN_URL . '/robovalley-landing/assets/robovalley-fonts.css', array(), ROBOVALLEY_LANDING_VERSION );
		$deps[] = 'rvp-projects-fonts';
	}
	wp_enqueue_style( 'rvp-projects-page', RVP_URL . 'assets/rvp-projects-page.css', $deps, RVP_VERSION );
	wp_enqueue_script( 'rvp-projects-page', RVP_URL . 'assets/rvp-projects-page.js', array(), RVP_VERSION, array( 'in_footer' => true, 'strategy' => 'defer' ) );
	wp_add_inline_script(
		'rvp-projects-page',
		'window.RVP_PAGE=' . wp_json_encode(
			array(
				'catalogue' => rest_url( 'rvp/v1/projects' ),
				'query'     => rest_url( 'rvp/v1/projects/query' ),
				'app'       => rvp_app_base(),
				'perPage'   => RVP_PAGE_PER_PAGE,
				'pageUrl'   => rvp_page_url(),
				'imgBase'   => RVP_URL . 'assets/img/', // folder of the fallback illustrations (public static files).
			)
		) . ';',
		'before'
	);
}
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( rvp_page_is_flagged() ) {
			rvp_page_enqueue();
		}
	},
	20
);

add_filter(
	'body_class',
	function ( $classes ) {
		if ( rvp_page_is_flagged() ) {
			$classes[] = 'rvp-projects-page-body';
		}
		return $classes;
	}
);

/* ---------- Markup (public data only, everything escaped) ---------- */

function rvp_page_img_html( $img, $class ) {
	if ( ! $img ) {
		return '';
	}
	return sprintf(
		'<img class="%s" src="%s"%s width="%d" height="%d" alt="%s" loading="lazy" decoding="async" sizes="(max-width: 700px) 92vw, 360px">',
		esc_attr( $class ),
		esc_url( $img['url'] ),
		! empty( $img['srcset'] ) ? ' srcset="' . esc_attr( $img['srcset'] ) . '"' : '',
		(int) $img['width'],
		(int) $img['height'],
		esc_attr( $img['alt'] )
	);
}

/**
 * Fallback pictures: one small original illustration per technology (static files in assets/img/). Only the file names listed
 * here are ever used, picked by technology slug; any other technology (for example one an admin adds later) gets the default.
 * A real image (a project's featured image, a technology's own image) always wins: these are only used when there is none.
 * Keep in step with RVP_ILLUS in assets/rvp-projects-page.js.
 */
function rvp_page_illustration_files() {
	return array(
		'robotics'                => 'tech-robotics.svg',
		'embedded-systems'        => 'tech-embedded-systems.svg',
		'stem'                    => 'tech-stem.svg',
		'artificial-intelligence' => 'tech-artificial-intelligence.svg',
		'iot'                     => 'tech-iot.svg',
		'3d-printing'             => 'tech-3d-printing.svg',
		'automation'              => 'tech-automation.svg',
		'electronics'             => 'tech-electronics.svg',
		'drone-technology'        => 'tech-drone-technology.svg',
		'other-technologies'      => 'tech-other-technologies.svg',
	);
}

/** The illustration file for a technology slug: from the whitelist above, or the neutral default. */
function rvp_page_illustration_file( $slug ) {
	$files = rvp_page_illustration_files();
	return ( is_string( $slug ) && isset( $files[ $slug ] ) ) ? $files[ $slug ] : 'tech-default.svg';
}

/** The illustration as a normal lazy <img> (never inline markup). $name is the technology's name, if there is one. */
function rvp_page_illustration_html( $slug, $name, $class ) {
	$alt = '' !== (string) $name ? sprintf( __( '%s illustration', 'robovalley-projects' ), $name ) : __( 'Project illustration', 'robovalley-projects' );
	return sprintf(
		'<img class="%s rvp-illus" src="%s" width="320" height="200" alt="%s" loading="lazy" decoding="async">',
		esc_attr( $class ),
		esc_url( RVP_URL . 'assets/img/' . rvp_page_illustration_file( $slug ) ),
		esc_attr( $alt )
	);
}

function rvp_page_card_html( array $p ) {
	$id    = (int) $p['id'];
	$login = rvp_page_auth_url( '/login', $id );
	$tech  = '';
	foreach ( $p['technology'] as $t ) {
		$tech .= '<span class="rvp-chip rvp-chip-tech">' . esc_html( $t['name'] ) . '</span>';
	}
	$edu = '';
	foreach ( $p['education'] as $e ) {
		$edu .= '<li>' . esc_html( $e['name'] ) . '</li>';
	}
	$diff = $p['difficulty'] ? '<span class="rvp-diff rvp-diff-' . esc_attr( $p['difficulty']['slug'] ) . '">' . esc_html( $p['difficulty']['label'] ) . '</span>' : '';
	$first = ! empty( $p['technology'][0] ) ? $p['technology'][0] : null;
	$media = rvp_page_img_html( $p['thumbnail'], 'rvp-card-img' ); // a real featured image always wins.
	if ( '' === $media ) {
		$media = rvp_page_illustration_html( $first ? $first['slug'] : '', $first ? $first['name'] : '', 'rvp-card-img' );
	}
	$chip = $first ? '<span class="rvp-card-chip">' . esc_html( $first['name'] ) . '</span>' : '';
	// The meta rows (difficulty, education levels). Keep in step with cardEl() in assets/rvp-projects-page.js.
	$meta = '';
	if ( $diff ) {
		$meta .= '<div class="rvp-meta-row"><span class="rvp-meta-label">' . esc_html__( 'Difficulty', 'robovalley-projects' ) . '</span>' . $diff . '</div>';
	}
	if ( $edu ) {
		$meta .= '<div class="rvp-meta-row"><span class="rvp-meta-label">' . esc_html__( 'Levels', 'robovalley-projects' ) . '</span><ul class="rvp-levels" aria-label="' . esc_attr__( 'Education levels', 'robovalley-projects' ) . '">' . $edu . '</ul></div>';
	}
	return '<article class="rvp-card" data-id="' . $id . '">'
		. '<div class="rvp-card-media">' . $media . $chip . '</div>'
		. '<div class="rvp-card-body">'
		. '<div class="rvp-card-tags">' . $tech . '</div>'
		. '<h3 class="rvp-card-title">' . esc_html( $p['title'] ) . '</h3>'
		. ( '' !== $p['short_description'] ? '<p class="rvp-card-desc">' . esc_html( $p['short_description'] ) . '</p>' : '' )
		. ( $meta ? '<div class="rvp-card-meta">' . $meta . '</div>' : '' )
		. '<a class="rvp-btn rvp-btn-primary" data-rvp-view="' . $id . '" href="' . esc_url( '' !== $login ? $login : '#' ) . '">' . esc_html__( 'View Project', 'robovalley-projects' ) . '<span class="rvp-sr"> ' . esc_html( $p['title'] ) . '</span></a>'
		. '</div></article>';
}

function rvp_page_hero_svg() {
	return '<svg class="rvp-hero-art" viewBox="0 0 420 360" role="img" aria-label="' . esc_attr__( 'A friendly robot with circuit lines', 'robovalley-projects' ) . '" focusable="false">'
		. '<defs><linearGradient id="rvpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e8f6e"/><stop offset="1" stop-color="#17694f"/></linearGradient></defs>'
		. '<g class="rvp-art-grid" stroke="#b5cdc3" stroke-opacity=".28" stroke-width="1"><path d="M0 60h420M0 120h420M0 180h420M0 240h420M0 300h420M60 0v360M120 0v360M180 0v360M240 0v360M300 0v360M360 0v360"/></g>'
		. '<g class="rvp-art-trace" fill="none" stroke="#e8a33a" stroke-width="3" stroke-linecap="round"><path d="M30 300h70l30-40h60"/><path d="M390 80h-60l-30 40h-50"/><path d="M40 90h50l20 30"/></g>'
		. '<g class="rvp-art-nodes" fill="#e8a33a"><circle cx="30" cy="300" r="6"/><circle cx="390" cy="80" r="6"/><circle cx="40" cy="90" r="6"/></g>'
		. '<g class="rvp-art-robot"><rect x="140" y="110" width="140" height="120" rx="26" fill="url(#rvpg)"/><rect x="160" y="132" width="100" height="62" rx="16" fill="#123f33"/>'
		. '<circle class="rvp-art-eye" cx="190" cy="163" r="11" fill="#eef5f1"/><circle class="rvp-art-eye" cx="230" cy="163" r="11" fill="#eef5f1"/><rect x="198" y="182" width="24" height="5" rx="2.5" fill="#e8a33a"/>'
		. '<path d="M210 110V80" stroke="#17694f" stroke-width="6" stroke-linecap="round"/><circle cx="210" cy="72" r="10" fill="#e8a33a"/>'
		. '<rect x="168" y="236" width="84" height="46" rx="14" fill="#17694f"/><rect x="104" y="244" width="28" height="14" rx="7" fill="#2e8f6e"/><rect x="288" y="244" width="28" height="14" rx="7" fill="#2e8f6e"/>'
		. '<rect x="178" y="282" width="24" height="26" rx="8" fill="#123f33"/><rect x="218" y="282" width="24" height="26" rx="8" fill="#123f33"/></g></svg>';
}

function rvp_page_check_svg() {
	return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

/** A group of checkboxes. $options: list of [value, label]. */
function rvp_page_filter_group( $key, $title, array $options ) {
	if ( ! $options ) {
		return ''; // no options (e.g. no technologies yet): show nothing rather than a heading with nothing under it.
	}
	$html = '<fieldset class="rvp-fgroup" data-group="' . esc_attr( $key ) . '"><legend>' . esc_html( $title ) . '</legend>';
	foreach ( $options as $o ) {
		$html .= '<label class="rvp-check"><input type="checkbox" name="' . esc_attr( $key ) . '" value="' . esc_attr( $o[0] ) . '"><span class="rvp-check-box">' . rvp_page_check_svg() . '</span><span>' . esc_html( $o[1] ) . '</span></label>';
	}
	return $html . '</fieldset>';
}

function rvp_page_shortcode() {
	rvp_page_enqueue(); // safety net: also works when the page flag was not set.
	do_action( 'litespeed_tag_add', 'rvp_catalogue' ); // so edits to projects purge this page too (LiteSpeed: needs staging).

	// First page of the catalogue, server side: the featured projects if there are any, otherwise everything.
	$has_featured = rvp_catalogue_query( array( 'search' => '', 'technology' => array(), 'education' => array(), 'difficulty' => array(), 'view' => 'featured', 'page' => 1, 'per_page' => 1, 'include' => null ) )->found_posts > 0;
	$view         = $has_featured ? 'featured' : 'all';
	$query        = rvp_catalogue_query( array( 'search' => '', 'technology' => array(), 'education' => array(), 'difficulty' => array(), 'view' => $view, 'page' => 1, 'per_page' => RVP_PAGE_PER_PAGE, 'include' => null ) );
	$cards        = '';
	foreach ( $query->posts as $post ) {
		$cards .= rvp_page_card_html( rvp_public_project( $post ) );
	}
	$total       = (int) $query->found_posts;
	$techs       = rvp_technology_list();
	$edu_options = array();
	foreach ( get_terms( array( 'taxonomy' => RVP_TAX_EDU, 'hide_empty' => false ) ) as $t ) {
		$edu_options[] = $t;
	}
	usort( $edu_options, 'rvp_compare_terms' );
	$edu_options = array_map( function ( $t ) { return array( $t->slug, rvp_plain( $t->name ) ); }, $edu_options );
	$tech_options = array_map( function ( $t ) { return array( $t['slug'], $t['name'] ); }, $techs );
	$diff_options = array();
	foreach ( rvp_difficulties() as $slug => $label ) {
		$diff_options[] = array( $slug, $label );
	}

	// "At a glance" numbers for the hero: public counts only (published projects, technologies, education levels).
	$all_total = (int) rvp_catalogue_query( array( 'search' => '', 'technology' => array(), 'education' => array(), 'difficulty' => array(), 'view' => 'all', 'page' => 1, 'per_page' => 1, 'include' => null ) )->found_posts;
	$stats     = array();
	if ( $all_total > 0 ) {
		$stats[] = array( $all_total, _n( 'Project', 'Projects', $all_total, 'robovalley-projects' ) );
		if ( $techs ) {
			$stats[] = array( count( $techs ), _n( 'Technology', 'Technologies', count( $techs ), 'robovalley-projects' ) );
		}
		if ( $edu_options ) {
			$stats[] = array( count( $edu_options ), _n( 'Education level', 'Education levels', count( $edu_options ), 'robovalley-projects' ) );
		}
	}

	$tiles = '';
	foreach ( $techs as $t ) {
		$img    = rvp_page_img_html( $t['image'], 'rvp-tile-img' );
		$tiles .= '<a class="rvp-tile" href="#rvp-discover" data-tech="' . esc_attr( $t['slug'] ) . '">'
			. '<span class="rvp-tile-media">' . ( $img ? $img : rvp_page_illustration_html( $t['slug'], $t['name'], 'rvp-tile-img' ) ) . '</span>'
			. '<span class="rvp-tile-name">' . esc_html( $t['name'] ) . '</span>'
			. ( '' !== $t['description'] ? '<span class="rvp-tile-desc">' . esc_html( $t['description'] ) . '</span>' : '' )
			. '<span class="rvp-tile-count">' . esc_html( sprintf( _n( '%d project', '%d projects', $t['count'], 'robovalley-projects' ), $t['count'] ) ) . '</span></a>';
	}

	ob_start();
	?>
<div class="rvp-page" id="rvp-root" data-view="<?php echo esc_attr( $view ); ?>" data-total="<?php echo (int) $total; ?>" data-per-page="<?php echo (int) RVP_PAGE_PER_PAGE; ?>">
	<section class="rvp-hero" aria-labelledby="rvp-hero-title">
		<div class="rvp-wrap rvp-hero-grid">
			<div class="rvp-hero-copy">
				<p class="rvp-eyebrow"><?php esc_html_e( 'Explore Projects', 'robovalley-projects' ); ?></p>
				<h1 id="rvp-hero-title" class="rvp-hero-title"><?php esc_html_e( 'Ideas into Innovation.', 'robovalley-projects' ); ?></h1>
				<p class="rvp-hero-text"><?php esc_html_e( 'Discover innovative projects, explore emerging technologies and find your next idea to build. From foundational STEM concepts to advanced engineering applications, explore possibilities with RoboValley.', 'robovalley-projects' ); ?></p>
				<div class="rvp-hero-actions">
					<form class="rvp-search rvp-js-only" role="search" id="rvp-hero-search" autocomplete="off">
						<label class="rvp-sr" for="rvp-q"><?php esc_html_e( 'Search projects, technologies and topics', 'robovalley-projects' ); ?></label>
						<input id="rvp-q" type="search" name="q" maxlength="100" placeholder="<?php esc_attr_e( 'Search projects, technologies, ideas…', 'robovalley-projects' ); ?>">
						<button type="submit" class="rvp-btn rvp-btn-amber"><?php esc_html_e( 'Search', 'robovalley-projects' ); ?></button>
					</form>
					<p class="rvp-hero-cta"><a class="rvp-btn rvp-btn-light" href="#rvp-discover"><?php esc_html_e( 'Browse all projects', 'robovalley-projects' ); ?></a></p>
				</div>
				<?php if ( $stats ) : ?>
				<ul class="rvp-hero-stats" aria-label="<?php esc_attr_e( 'RoboValley Projects at a glance', 'robovalley-projects' ); ?>">
					<?php foreach ( $stats as $s ) : ?>
						<li><strong><?php echo (int) $s[0]; ?></strong><span><?php echo esc_html( $s[1] ); ?></span></li>
					<?php endforeach; ?>
				</ul>
				<?php endif; ?>
			</div>
			<div class="rvp-hero-visual"><?php echo rvp_page_hero_svg(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup built from escaped parts. ?></div>
		</div>
	</section>

	<?php if ( $tiles ) : ?>
	<section class="rvp-section" aria-labelledby="rvp-tech-title">
		<div class="rvp-wrap">
			<h2 id="rvp-tech-title" class="rvp-h2"><?php esc_html_e( 'Explore by Technology', 'robovalley-projects' ); ?></h2>
			<div class="rvp-tiles" id="rvp-tiles"><?php echo $tiles; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above. ?></div>
		</div>
	</section>
	<?php endif; ?>

	<section class="rvp-section rvp-discover" id="rvp-discover" aria-labelledby="rvp-disc-title">
		<div class="rvp-wrap">
			<h2 id="rvp-disc-title" class="rvp-h2"><?php esc_html_e( 'Discover Projects', 'robovalley-projects' ); ?></h2>
			<div class="rvp-layout">
				<aside class="rvp-filters rvp-js-only" id="rvp-filters" aria-label="<?php esc_attr_e( 'Filters', 'robovalley-projects' ); ?>">
					<div class="rvp-filters-head"><h3><?php esc_html_e( 'Filters', 'robovalley-projects' ); ?></h3><button type="button" class="rvp-linkbtn" id="rvp-filters-clear" hidden><?php esc_html_e( 'Clear all', 'robovalley-projects' ); ?></button><button type="button" class="rvp-iconbtn rvp-drawer-close" id="rvp-drawer-close" aria-label="<?php esc_attr_e( 'Close filters', 'robovalley-projects' ); ?>">&times;</button></div>
					<?php
					echo rvp_page_filter_group( 'technology', __( 'Technology', 'robovalley-projects' ), $tech_options ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					echo rvp_page_filter_group( 'education', __( 'Education level', 'robovalley-projects' ), $edu_options ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					echo rvp_page_filter_group( 'difficulty', __( 'Difficulty', 'robovalley-projects' ), $diff_options ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
					?>
					<fieldset class="rvp-fgroup rvp-fgroup-locked" data-group="subject" id="rvp-subject-group">
						<legend><?php esc_html_e( 'Subject', 'robovalley-projects' ); ?></legend>
						<button type="button" class="rvp-locked" id="rvp-subject-lock" aria-haspopup="dialog">
							<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
							<span><?php esc_html_e( 'Members only: filter by subject', 'robovalley-projects' ); ?></span>
						</button>
						<div class="rvp-subject-options" id="rvp-subject-options" hidden></div>
					</fieldset>
					<button type="button" class="rvp-btn rvp-btn-primary rvp-drawer-done" id="rvp-drawer-done"><?php esc_html_e( 'Show results', 'robovalley-projects' ); ?></button>
				</aside>
				<div class="rvp-results">
					<div class="rvp-toolbar">
						<div class="rvp-tabs" role="tablist" aria-label="<?php esc_attr_e( 'Project lists', 'robovalley-projects' ); ?>">
							<?php foreach ( array( 'featured' => __( 'Featured', 'robovalley-projects' ), 'latest' => __( 'Latest', 'robovalley-projects' ), 'all' => __( 'All', 'robovalley-projects' ) ) as $key => $label ) : ?>
								<button type="button" role="tab" class="rvp-tab" id="rvp-tab-<?php echo esc_attr( $key ); ?>" data-view="<?php echo esc_attr( $key ); ?>" aria-selected="<?php echo $key === $view ? 'true' : 'false'; ?>" aria-controls="rvp-grid" tabindex="<?php echo $key === $view ? '0' : '-1'; ?>"><?php echo esc_html( $label ); ?></button>
							<?php endforeach; ?>
						</div>
						<button type="button" class="rvp-btn rvp-btn-ghost rvp-filter-open rvp-js-only" id="rvp-filter-open" aria-controls="rvp-filters" aria-expanded="false"><?php esc_html_e( 'Filters', 'robovalley-projects' ); ?><span class="rvp-badge" id="rvp-filter-count" hidden>0</span></button>
					</div>
					<div class="rvp-chips rvp-js-only" id="rvp-chips" aria-label="<?php esc_attr_e( 'Active filters', 'robovalley-projects' ); ?>"></div>
					<p class="rvp-status" id="rvp-status" role="status" aria-live="polite"></p>
					<div class="rvp-grid" id="rvp-grid" role="tabpanel" aria-live="off"><?php echo $cards; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in rvp_page_card_html(). ?></div>
					<div class="rvp-empty" id="rvp-empty" <?php echo $cards ? 'hidden' : ''; ?>>
						<h3><?php esc_html_e( 'No projects found', 'robovalley-projects' ); ?></h3>
						<p><?php echo $cards ? esc_html__( 'Try different filters or a shorter search.', 'robovalley-projects' ) : esc_html__( 'There are no projects here yet. Please check back soon.', 'robovalley-projects' ); ?></p>
						<button type="button" class="rvp-btn rvp-btn-ghost rvp-js-only" id="rvp-empty-clear"><?php esc_html_e( 'Clear all filters', 'robovalley-projects' ); ?></button>
					</div>
					<div class="rvp-more-wrap rvp-js-only"><button type="button" class="rvp-btn rvp-btn-ghost" id="rvp-more" <?php echo $total > RVP_PAGE_PER_PAGE ? '' : 'hidden'; ?>><?php esc_html_e( 'Load more', 'robovalley-projects' ); ?></button></div>
				</div>
			</div>
		</div>
	</section>
	<noscript><p class="rvp-noscript"><?php esc_html_e( 'Search and filters need JavaScript. The projects above are still available.', 'robovalley-projects' ); ?></p></noscript>
</div>
	<?php
	return (string) ob_get_clean();
}
add_shortcode( 'robovalley_projects', 'rvp_page_shortcode' );
