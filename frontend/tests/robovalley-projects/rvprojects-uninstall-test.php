<?php
// RoboValley Projects: uninstall.php removes the capabilities, the seed flag and the bridge nonce rows, and deletes NO content.
// LOCAL TEST SITE ONLY (it runs the real uninstall.php, then puts the capabilities and the seed flag back).
// Run: wp eval-file rvprojects-uninstall-test.php   (plugin active; run rvprojects-testdata-setup.php first so there is content to protect)

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . $detail : '' ) . "\n";
}
global $wpdb;

function rvpu_snapshot() {
	global $wpdb;
	return array(
		'projects'   => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s", RVP_POST_TYPE ) ),
		'posts'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type NOT IN ( 'rv_project' )" ),
		'meta'       => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->postmeta}" ),
		'terms'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->term_taxonomy}" ),
		'termmeta'   => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->termmeta}" ),
		'users'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->users}" ),
		'nonrvpopts' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name NOT LIKE 'rvp\_%' AND option_name NOT LIKE '\_transient%' AND option_name NOT LIKE '\_site\_transient%'" ),
	);
}

$seeded_before = get_option( 'rvp_terms_seeded', null );
$had_cap       = (bool) get_role( 'editor' ) && get_role( 'editor' )->has_cap( 'edit_rv_projects' );
t( 'precondition: the editor role has the project capability', $had_cap );
t( 'precondition: there is project content to protect', rvpu_snapshot()['projects'] > 0, 'run rvprojects-testdata-setup.php first' );

// nonce rows like the bridge writes, a decoy with a similar name, and an unrelated option
foreach ( array( 'a', 'b', 'c' ) as $x ) {
	$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} ( option_name, option_value, autoload ) VALUES ( %s, %s, 'no' )", 'rvp_bridge_nonce_' . str_repeat( $x, 40 ), (string) ( time() + 120 ) ) );
}
update_option( 'rvp_bridge_nonceX_decoy', 'keep', false );
update_option( 'rvpu_unrelated_option', 'keep', false );
$count_nonce = function () use ( $wpdb ) {
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'rvp_bridge_nonce_' ) . '%' ) );
};
t( 'precondition: at least our 3 nonce rows exist', $count_nonce() >= 3 );

$before = rvpu_snapshot();
define( 'WP_UNINSTALL_PLUGIN', 'robovalley-projects/robovalley-projects.php' );
require WP_PLUGIN_DIR . '/robovalley-projects/uninstall.php';
$after = rvpu_snapshot();

t( 'uninstall: every bridge nonce row is gone', 0 === $count_nonce() );
t( 'uninstall: a similarly named option and an unrelated option are untouched', 'keep' === get_option( 'rvp_bridge_nonceX_decoy' ) && 'keep' === get_option( 'rvpu_unrelated_option' ) );
t( 'uninstall: the seed flag is removed', false === get_option( 'rvp_terms_seeded', false ) );
t( 'uninstall: the capabilities are removed from the roles', ! get_role( 'editor' )->has_cap( 'edit_rv_projects' ) && ! get_role( 'administrator' )->has_cap( 'edit_rv_projects' ) );
foreach ( $before as $k => $v ) {
	t( "uninstall: no content deleted ($k: $v)", $v === $after[ $k ], 'now ' . $after[ $k ] );
}

// put the site back
rvp_grant_capabilities();
if ( null !== $seeded_before ) { update_option( 'rvp_terms_seeded', $seeded_before ); }
delete_option( 'rvp_bridge_nonceX_decoy' );
delete_option( 'rvpu_unrelated_option' );
t( 'restored: the editor role has the project capability again', get_role( 'editor' )->has_cap( 'edit_rv_projects' ) );

echo "\n{$GLOBALS['rvp_pass']} passed, {$GLOBALS['rvp_fail']} failed\n";
