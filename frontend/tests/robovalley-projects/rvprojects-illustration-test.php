<?php
// RoboValley Projects: technology illustrations (card and tile fallback pictures) and the card chip. LOCAL TEST SITE ONLY.
// Run: wp eval-file rvprojects-illustration-test.php   (plugin active; it creates and removes its own fixtures)

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . ( is_string( $detail ) ? $detail : wp_json_encode( $detail ) ) : '' ) . "\n";
}
wp_set_current_user( 0 );

$dir      = RVP_DIR . 'assets/img/';
$seeded   = array_keys( rvp_seed_data()[ RVP_TAX_TECH ] );
$files    = rvp_page_illustration_files();
$robotics = get_term_by( 'slug', 'robotics', RVP_TAX_TECH );
if ( ! $robotics ) {
	WP_CLI::error( 'The seeded technologies are missing (activate the plugin first).' );
}

// ---- the whitelist and the shipped files
t( 'the whitelist covers exactly the ten seeded technologies', array_keys( $files ) === $seeded || ( count( $files ) === count( $seeded ) && ! array_diff( $seeded, array_keys( $files ) ) ), array( array_diff( $seeded, array_keys( $files ) ), array_diff( array_keys( $files ), $seeded ) ) );
$all = array_merge( array_values( $files ), array( 'tech-default.svg' ) );
t( 'eleven different illustration files (ten technologies and a default)', count( array_unique( $all ) ) === 11 );
$bad = array();
foreach ( $all as $f ) {
	$path = $dir . $f;
	if ( ! preg_match( '/^tech-[a-z0-9-]+\.svg$/', $f ) || ! is_file( $path ) ) {
		$bad[] = "$f missing or oddly named";
		continue;
	}
	$raw = (string) file_get_contents( $path );
	if ( strlen( $raw ) > 5120 ) {
		$bad[] = "$f is " . strlen( $raw ) . ' bytes';
	}
	$prev = libxml_use_internal_errors( true );
	$doc  = new DOMDocument();
	$ok   = $doc->loadXML( $raw ) && 'svg' === $doc->documentElement->nodeName && 'http://www.w3.org/2000/svg' === $doc->documentElement->namespaceURI;
	libxml_clear_errors();
	libxml_use_internal_errors( $prev );
	if ( ! $ok ) {
		$bad[] = "$f is not well-formed SVG";
	}
	// static pictures only: no script, no handlers, no links, no embedded objects, no web address except the SVG namespace
	$stripped = str_replace( 'http://www.w3.org/2000/svg', '', $raw );
	if ( preg_match( '/<script|<foreignObject|<style|<image|<use|\son[a-z]+\s*=|href\s*=|xlink|javascript:|https?:|data:|@import|url\(/i', $stripped ) ) {
		$bad[] = "$f contains something active or external";
	}
	if ( false !== strpos( $raw, '<animate' ) || false !== strpos( $raw, '<set ' ) ) {
		$bad[] = "$f is animated";
	}
}
t( 'every illustration is a well-formed, static SVG of 5 KB or less with no script, link or external address', ! $bad, $bad );

// ---- picking a file (whitelist, default for everything else)
$known_ok = true;
foreach ( $files as $slug => $file ) {
	$known_ok = $known_ok && rvp_page_illustration_file( $slug ) === $file;
}
t( 'each known slug gets its own file', $known_ok );
$odd = array( 'zz-new-tech', '', null, array(), '../../etc/passwd', 'robotics/../x', 'robotics.svg', 'constructor', '__proto__', 'ROBOTICS', 0, 3.5, false, 'tech-robotics.svg', "robotics\0" );
$odd_ok = true;
foreach ( $odd as $o ) {
	$odd_ok = $odd_ok && 'tech-default.svg' === rvp_page_illustration_file( $o );
}
t( 'an unknown slug, odd input, path tricks and prototype-looking names all get the default file', $odd_ok );

// ---- the markup helper
$h = rvp_page_illustration_html( 'robotics', 'Robotics', 'rvp-card-img' );
t( 'helper: a lazy <img> with the technology file, width, height, alt and both classes', (bool) preg_match( '#^<img class="rvp-card-img rvp-illus" src="[^"]+/assets/img/tech-robotics\.svg" width="320" height="200" alt="Robotics illustration" loading="lazy" decoding="async">$#', $h ), $h );
$h2 = rvp_page_illustration_html( 'robotics', '<i>x</i> & "q"', 'rvp-tile-img' );
t( 'helper: the name is escaped in the alt text', false === strpos( $h2, '<i>' ) && false !== strpos( $h2, '&lt;i&gt;' ), $h2 );
t( 'helper: no name gives a neutral alt text', false !== strpos( rvp_page_illustration_html( '', '', 'x' ), 'alt="Project illustration"' ) );

// ---- fixtures: three projects (no image + robotics, no image + a NEW technology, real featured image) and one with no technology
$new_term = wp_insert_term( 'RVP Test New Tech', RVP_TAX_TECH, array( 'slug' => 'rvp-test-new-tech' ) );
$new_id   = is_wp_error( $new_term ) ? 0 : (int) $new_term['term_id'];
t( 'fixture: a new technology that the plugin has never heard of', $new_id > 0, is_wp_error( $new_term ) ? $new_term->get_error_message() : '' );

$made = array();
function rvpi_project( $title, $term_ids ) {
	$id = wp_insert_post( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'publish', 'post_title' => $title ) );
	update_post_meta( $id, '_rvp_short_desc', 'Illustration test' );
	update_post_meta( $id, '_rvp_difficulty', 'beginner' );
	if ( $term_ids ) {
		wp_set_object_terms( $id, array_map( 'intval', $term_ids ), RVP_TAX_TECH );
	}
	return (int) $id;
}
$p_robo = rvpi_project( 'RVP ILLUS robotics no image', array( $robotics->term_id ) );
$p_new  = rvpi_project( 'RVP ILLUS new tech no image', array( $new_id ) );
$p_none = rvpi_project( 'RVP ILLUS no technology', array() );
$p_real = rvpi_project( 'RVP ILLUS real image', array( $robotics->term_id ) );
$made   = array( $p_robo, $p_new, $p_none, $p_real );

require_once ABSPATH . 'wp-admin/includes/image.php';
$up   = wp_upload_dir();
$file = $up['path'] . '/rvp-illus-test.png';
copy( ABSPATH . WPINC . '/images/w-logo-blue.png', $file );
$att = wp_insert_attachment( array( 'post_mime_type' => 'image/png', 'post_title' => 'rvp illus test', 'post_status' => 'inherit' ), $file );
wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $file ) );
update_post_meta( $att, '_wp_attachment_image_alt', 'A real project photo' );
set_post_thumbnail( $p_real, $att );

$card = function ( $pid ) {
	return rvp_page_card_html( rvp_public_project( get_post( $pid ) ) );
};
$c1 = $card( $p_robo );
t( 'card without an image: the robotics illustration, a technology chip on the picture, no grey placeholder', (bool) preg_match( '#<div class="rvp-card-media"><img class="rvp-card-img rvp-illus" src="[^"]+/tech-robotics\.svg"[^>]*alt="Robotics illustration"[^>]*><span class="rvp-card-chip">Robotics</span></div>#', $c1 ) && false === strpos( $c1, 'rvp-card-ph' ), $c1 );
$c2 = $card( $p_new );
t( 'card for a brand-new technology: the neutral default illustration, the chip still names it', false !== strpos( $c2, '/tech-default.svg' ) && false !== strpos( $c2, '<span class="rvp-card-chip">RVP Test New Tech</span>' ), $c2 );
$c3 = $card( $p_none );
t( 'card with no technology at all: the default illustration and no chip', false !== strpos( $c3, '/tech-default.svg' ) && false === strpos( $c3, 'rvp-card-chip' ), $c3 );
$c4 = $card( $p_real );
t( 'card with a real featured image: the real image is shown, not an illustration', false !== strpos( $c4, 'rvp-illus-test' ) && false === strpos( $c4, 'rvp-illus"' ) && false === strpos( $c4, '.svg' ) && false !== strpos( $c4, 'alt="A real project photo"' ) && false !== strpos( $c4, 'rvp-card-chip' ), $c4 );

// escaping of everything that comes from a name
$evil = rvp_page_card_html( array( 'id' => 1, 'title' => 'T', 'short_description' => '', 'thumbnail' => null, 'technology' => array( array( 'slug' => 'robotics', 'name' => '<script>alert(1)</script>' ) ), 'education' => array(), 'difficulty' => null ) );
t( 'card: a technology name with markup is escaped in the chip, the tag and the alt text', false === strpos( $evil, '<script' ) && substr_count( $evil, '&lt;script&gt;' ) >= 3, $evil );

// ---- the whole page: tiles and the config given to the script
$html = do_shortcode( '[robovalley_projects]' );
t( 'page: the robotics tile shows the robotics illustration', (bool) preg_match( '#data-tech="robotics"[^>]*><span class="rvp-tile-media"><img class="rvp-tile-img rvp-illus" src="[^"]+/tech-robotics\.svg"#', $html ) );
t( 'page: the new technology tile shows the default illustration', (bool) preg_match( '#data-tech="rvp-test-new-tech"[^>]*><span class="rvp-tile-media"><img class="rvp-tile-img rvp-illus" src="[^"]+/tech-default\.svg"#', $html ) );
t( 'page: the generic grey placeholder is gone from the server markup', false === strpos( $html, 'rvp-card-ph' ) );
$cfg = wp_scripts()->get_data( 'rvp-projects-page', 'before' );
$cfg = is_array( $cfg ) ? implode( '', $cfg ) : (string) $cfg;
t( 'page: the script config carries the image folder (a plain public address) and nothing secret', (bool) preg_match( '#"imgBase":"https?:\\\\/\\\\/[^"]+\\\\/assets\\\\/img\\\\/"#', $cfg ) && false === stripos( $cfg, 'secret' ), $cfg );

// a technology's own image still wins on its tile
update_term_meta( $new_id, 'rvp_image_id', $att );
$html2 = do_shortcode( '[robovalley_projects]' );
t( 'page: a technology with its own image shows that image on its tile, not the illustration', (bool) preg_match( '#data-tech="rvp-test-new-tech"[^>]*><span class="rvp-tile-media"><img class="rvp-tile-img" src="[^"]*rvp-illus-test#', $html2 ) );

// ---- clean up
foreach ( $made as $pid ) {
	wp_delete_post( $pid, true );
}
wp_delete_attachment( $att, true );
if ( is_file( $file ) ) { unlink( $file ); }
delete_term_meta( $new_id, 'rvp_image_id' );
wp_delete_term( $new_id, RVP_TAX_TECH );
$left = 0;
foreach ( $made as $pid ) {
	$left += get_post( $pid ) ? 1 : 0;
}
t( 'clean up: none of the fixtures is left', 0 === $left && ! get_term_by( 'slug', 'rvp-test-new-tech', RVP_TAX_TECH ) && ! get_post( $att ) );

echo "\n{$GLOBALS['rvp_pass']} passed, {$GLOBALS['rvp_fail']} failed\n";
