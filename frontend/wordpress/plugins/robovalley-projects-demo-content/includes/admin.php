<?php
/**
 * Projects > Demo content: the two buttons, the confirmation step, the status line, the notice and the "Demo" badge column.
 * Administrators only (manage_options).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rvpdc_page_url( array $args = array() ) {
	return add_query_arg( $args, admin_url( 'edit.php?post_type=rv_project&page=' . RVPDC_SLUG ) );
}

add_action(
	'admin_menu',
	function () {
		if ( ! current_user_can( 'manage_options' ) || ! defined( 'RVP_POST_TYPE' ) ) {
			return; // hidden from everyone else (and from administrators while the main plugin is inactive).
		}
		$hook = add_submenu_page(
			'edit.php?post_type=' . RVP_POST_TYPE,
			__( 'Demo content', 'robovalley-projects-demo-content' ),
			__( 'Demo content', 'robovalley-projects-demo-content' ),
			'manage_options',
			RVPDC_SLUG,
			'rvpdc_render_page'
		);
		if ( $hook ) {
			add_action( 'load-' . $hook, 'rvpdc_handle_run' );
		}
	},
	30
);

/** Step 2: the confirmed form runs the action, stores the report for this user and redirects (so a refresh cannot run it twice). */
function rvpdc_handle_run() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You are not allowed to do this.', 'robovalley-projects-demo-content' ), 403 );
	}
	if ( 'POST' !== $_SERVER['REQUEST_METHOD'] || ! isset( $_POST['rvpdc_do'] ) ) {
		return;
	}
	$do = sanitize_key( wp_unslash( $_POST['rvpdc_do'] ) );
	if ( ! in_array( $do, array( 'install', 'remove' ), true ) ) {
		wp_die( esc_html__( 'Unknown action.', 'robovalley-projects-demo-content' ), 400 );
	}
	if ( empty( $_POST['rvpdc_confirm'] ) ) {
		check_admin_referer( 'rvpdc_ask_' . $do ); // step 1: checked here, before any output, so a bad nonce is a real 403.
		return; // the confirmation screen is drawn by rvpdc_render_page().
	}
	check_admin_referer( 'rvpdc_run_' . $do );
	$result = 'install' === $do ? rvpdc_install() : rvpdc_remove();
	set_transient( 'rvpdc_report_' . get_current_user_id(), array( 'do' => $do, 'result' => is_wp_error( $result ) ? array( 'fatal' => $result->get_error_message() ) : $result ), 120 );
	wp_safe_redirect( rvpdc_page_url( array( 'rvpdc_done' => 1 ) ) );
	exit;
}

function rvpdc_render_report() {
	$report = get_transient( 'rvpdc_report_' . get_current_user_id() );
	if ( ! $report || empty( $_GET['rvpdc_done'] ) ) {
		return;
	}
	delete_transient( 'rvpdc_report_' . get_current_user_id() );
	$r = $report['result'];
	if ( isset( $r['fatal'] ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html( $r['fatal'] ) . '</p></div>';
		return;
	}
	if ( 'install' === $report['do'] ) {
		$msg = sprintf( 'Created %1$d demo project(s), imported %2$d image(s), left %3$d existing demo project(s) untouched.', $r['created'], $r['images'], $r['skipped'] );
		if ( ! empty( $r['remaining'] ) ) {
			$msg .= sprintf( ' This server ran out of time for one request: %d sample project(s) are still waiting. Click "Install demo projects" again to continue (nothing is duplicated).', $r['remaining'] );
		}
	} else {
		$msg = sprintf( 'Removed %1$d demo project(s) and %2$d demo image(s). Nothing else was touched.', $r['projects'], $r['images'] );
	}
	echo '<div class="notice notice-success"><p>' . esc_html( $msg ) . '</p></div>';
	if ( ! empty( $r['missing_terms'] ) ) {
		echo '<div class="notice notice-warning"><p>' . esc_html( 'These categories do not exist on this site, so they were skipped (nothing was created): ' . implode( ', ', $r['missing_terms'] ) ) . '</p></div>';
	}
	if ( ! empty( $r['errors'] ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html( implode( ' | ', $r['errors'] ) ) . '</p></div>';
	}
}

function rvpdc_render_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You are not allowed to access this page.', 'robovalley-projects-demo-content' ), 403 );
	}
	echo '<div class="wrap"><h1>' . esc_html__( 'Demo content', 'robovalley-projects-demo-content' ) . '</h1>';
	if ( ! rvpdc_main_plugin_ready() ) {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'The RoboValley Projects plugin must be active. Nothing can be installed or removed until it is.', 'robovalley-projects-demo-content' ) . '</p></div></div>';
		return;
	}
	rvpdc_render_report();

	// Step 1 -> confirmation screen (changes nothing).
	$ask = '';
	if ( 'POST' === $_SERVER['REQUEST_METHOD'] && empty( $_POST['rvpdc_confirm'] ) && isset( $_POST['rvpdc_do'] ) ) {
		$ask = sanitize_key( wp_unslash( $_POST['rvpdc_do'] ) );
		if ( in_array( $ask, array( 'install', 'remove' ), true ) ) {
			check_admin_referer( 'rvpdc_ask_' . $ask );
		} else {
			$ask = '';
		}
	}
	if ( $ask ) {
		$n = count( rvpdc_project_ids() );
		echo '<h2>' . esc_html( 'install' === $ask ? __( 'Install the demo projects?', 'robovalley-projects-demo-content' ) : __( 'Remove the demo projects?', 'robovalley-projects-demo-content' ) ) . '</h2>';
		if ( 'install' === $ask ) {
			echo '<p>' . esc_html( sprintf( 'This adds the sample projects that are not installed yet (%1$d of %2$d are installed now), each with a generated thumbnail. Projects already installed are not changed.', $n, count( rvpdc_dataset() ) ) ) . '</p>';
		} else {
			echo '<p>' . esc_html( sprintf( 'This permanently deletes the %1$d demo project(s) and the %2$d demo image(s) added by this plugin. Projects and images you created yourself are not touched. This cannot be undone.', $n, count( rvpdc_attachment_ids() ) ) ) . '</p>';
		}
		echo '<form method="post" action="' . esc_url( rvpdc_page_url() ) . '">';
		wp_nonce_field( 'rvpdc_run_' . $ask );
		echo '<input type="hidden" name="rvpdc_do" value="' . esc_attr( $ask ) . '"><input type="hidden" name="rvpdc_confirm" value="1">';
		submit_button( 'install' === $ask ? __( 'Yes, install the demo projects', 'robovalley-projects-demo-content' ) : __( 'Yes, remove the demo projects', 'robovalley-projects-demo-content' ), 'install' === $ask ? 'primary' : 'delete', 'submit', false );
		echo ' <a class="button" href="' . esc_url( rvpdc_page_url() ) . '">' . esc_html__( 'Cancel', 'robovalley-projects-demo-content' ) . '</a></form></div>';
		return;
	}

	$ids   = rvpdc_project_ids();
	$total = count( rvpdc_dataset() );
	echo '<p><strong>' . esc_html( sprintf( '%1$d demo project(s) currently installed', count( $ids ) ) ) . '</strong> ' . esc_html( sprintf( '(%1$d of %2$d sample projects, %3$d demo image(s)).', count( $ids ), $total, count( rvpdc_attachment_ids() ) ) ) . '</p>';
	echo '<p>' . esc_html__( 'The sample projects are for presentations only. Their titles are clean on the public site, so tell your audience they are sample content. Remove them before the real launch.', 'robovalley-projects-demo-content' ) . '</p>';
	echo '<div style="display:flex;gap:12px;flex-wrap:wrap">';
	foreach ( array( 'install' => __( 'Install demo projects', 'robovalley-projects-demo-content' ), 'remove' => __( 'Remove demo projects', 'robovalley-projects-demo-content' ) ) as $do => $label ) {
		echo '<form method="post" action="' . esc_url( rvpdc_page_url() ) . '">';
		wp_nonce_field( 'rvpdc_ask_' . $do );
		echo '<input type="hidden" name="rvpdc_do" value="' . esc_attr( $do ) . '">';
		submit_button( $label, 'install' === $do ? 'primary' : 'secondary', 'submit', false, 'remove' === $do && ! $ids ? array( 'disabled' => 'disabled' ) : array() );
		echo '</form>';
	}
	echo '</div>';

	echo '<h2>' . esc_html__( 'The sample projects', 'robovalley-projects-demo-content' ) . '</h2><table class="widefat striped" style="max-width:900px"><thead><tr><th>' . esc_html__( 'Title', 'robovalley-projects-demo-content' ) . '</th><th>' . esc_html__( 'Difficulty', 'robovalley-projects-demo-content' ) . '</th><th>' . esc_html__( 'Featured', 'robovalley-projects-demo-content' ) . '</th><th>' . esc_html__( 'Installed', 'robovalley-projects-demo-content' ) . '</th></tr></thead><tbody>';
	foreach ( rvpdc_dataset() as $item ) {
		echo '<tr><td>' . esc_html( $item['title'] ) . '</td><td>' . esc_html( ucfirst( $item['difficulty'] ) ) . '</td><td>' . ( $item['featured'] ? 'Yes' : '—' ) . '</td><td>' . ( rvpdc_find_by_key( $item['key'] ) ? 'Yes' : '—' ) . '</td></tr>';
	}
	echo '</tbody></table></div>';
}

/** Notice on every admin screen (administrators only) while demo data exists, or when the main plugin is missing. */
add_action(
	'admin_notices',
	function () {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( ! rvpdc_main_plugin_ready() ) {
			echo '<div class="notice notice-warning"><p>' . esc_html__( 'RoboValley Projects: Demo Content needs the RoboValley Projects plugin to be active.', 'robovalley-projects-demo-content' ) . '</p></div>';
			return;
		}
		$n = count( rvpdc_project_ids() );
		if ( $n > 0 ) {
			echo '<div class="notice notice-warning"><p><strong>' . esc_html__( 'Demo content is installed. Remove it before real launch.', 'robovalley-projects-demo-content' ) . '</strong> ' . esc_html( sprintf( '(%d demo project(s))', $n ) ) . ' <a href="' . esc_url( rvpdc_page_url() ) . '">' . esc_html__( 'Open Demo content', 'robovalley-projects-demo-content' ) . '</a></p></div>';
		}
	}
);

/** "Demo" badge in the All Projects list. */
add_filter(
	'manage_rv_project_posts_columns',
	function ( $columns ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return $columns; // the badge is for administrators only.
		}
		$columns['rvpdc_demo'] = __( 'Demo', 'robovalley-projects-demo-content' );
		return $columns;
	},
	20
);
add_action(
	'manage_rv_project_posts_custom_column',
	function ( $column, $post_id ) {
		if ( 'rvpdc_demo' === $column && '1' === (string) get_post_meta( $post_id, '_rvp_demo', true ) ) {
			echo '<span style="background:#e3ede7;color:#123f33;border-radius:10px;padding:2px 9px;font-weight:600;font-size:11px">Demo</span>';
		}
	},
	10,
	2
);
add_filter(
	'display_post_states',
	function ( $states, $post ) {
		if ( $post && current_user_can( 'manage_options' ) && 'rv_project' === $post->post_type && '1' === (string) get_post_meta( $post->ID, '_rvp_demo', true ) ) {
			$states['rvpdc_demo'] = __( 'Demo content', 'robovalley-projects-demo-content' );
		}
		return $states;
	},
	10,
	2
);
