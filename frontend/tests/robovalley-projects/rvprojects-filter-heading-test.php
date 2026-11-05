<?php
// RoboValley Projects: the filter sidebar must not show a "Technology" heading with nothing under it. LOCAL TEST SITE ONLY.
// Run on a site with NO projects:  wp eval-file rvprojects-filter-heading-test.php   (it creates and deletes one project of its own)

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . $detail : '' ) . "\n";
}
wp_set_current_user( 0 );

$existing = get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) );
if ( $existing ) { WP_CLI::error( 'This test needs a site with no projects (remove demo / test data first).' ); }

// the helper itself
t( 'empty option list gives an empty string', '' === rvp_page_filter_group( 'technology', 'Technology', array() ) );
$one = rvp_page_filter_group( 'technology', 'Technology', array( array( 'robotics', 'Robotics' ) ) );
t( 'one option still renders heading and checkbox', false !== strpos( $one, '<legend>Technology</legend>' ) && false !== strpos( $one, 'value="robotics"' ) );

// the rendered page with no projects at all
$html = do_shortcode( '[robovalley_projects]' );
t( 'no projects: the page renders', false !== strpos( $html, 'rvp-page' ) );
t( 'no projects: no Technology filter group and no Technology legend', false === strpos( $html, 'data-group="technology"' ) && ! preg_match( '#<legend>\s*Technology\s*</legend>#', $html ) );
t( 'no projects: Education level and Difficulty groups are still there', false !== strpos( $html, 'data-group="education"' ) && false !== strpos( $html, 'data-group="difficulty"' ) );
t( 'no projects: the locked Subject group is still there', false !== strpos( $html, 'id="rvp-subject-lock"' ) );

// with one published project that has a technology
$tech = get_term_by( 'slug', 'robotics', RVP_TAX_TECH );
$pid  = wp_insert_post( array( 'post_type' => RVP_POST_TYPE, 'post_title' => 'RVP heading test', 'post_status' => 'publish' ) );
wp_set_object_terms( $pid, array( (int) $tech->term_id ), RVP_TAX_TECH );
$html2 = do_shortcode( '[robovalley_projects]' );
t( 'with a project: Technology group and heading are present', false !== strpos( $html2, 'data-group="technology"' ) && (bool) preg_match( '#<legend>Technology</legend>#', $html2 ) );
t( 'with a project: the Robotics checkbox is there', false !== strpos( $html2, 'name="technology" value="robotics"' ) );
wp_delete_post( $pid, true );
t( 'the test project is gone', ! get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) ) );

echo "\n{$GLOBALS['rvp_pass']} passed, {$GLOBALS['rvp_fail']} failed\n";
exit( $GLOBALS['rvp_fail'] ? 1 : 0 );
