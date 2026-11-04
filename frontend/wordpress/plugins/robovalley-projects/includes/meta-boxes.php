<?php
/**
 * Editor screen for a project: two meta boxes beside the native title, featured image and taxonomy boxes.
 * Each box has its own nonce and only saves its own fields, so hiding a box in Screen Options can't wipe its values.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'add_meta_boxes_' . RVP_POST_TYPE,
	function () {
		add_meta_box( 'rvp_summary', __( 'Project summary (shown to everyone)', 'robovalley-projects' ), 'rvp_render_summary_box', RVP_POST_TYPE, 'normal', 'high' );
		remove_meta_box( 'slugdiv', RVP_POST_TYPE, 'normal' ); // projects have no URL, so the slug box is just noise.
		add_meta_box( 'rvp_details', __( 'Project details (members only)', 'robovalley-projects' ), 'rvp_render_details_box', RVP_POST_TYPE, 'normal', 'default' );
	}
);

function rvp_render_summary_box( $post ) {
	wp_nonce_field( 'rvp_save_summary_' . $post->ID, 'rvp_nonce_summary' );
	$desc       = (string) get_post_meta( $post->ID, '_rvp_short_desc', true );
	$difficulty = (string) get_post_meta( $post->ID, '_rvp_difficulty', true );
	$featured   = (bool) get_post_meta( $post->ID, '_rvp_featured', true );
	$order      = (string) get_post_meta( $post->ID, '_rvp_order', true );
	?>
	<p class="description"><?php esc_html_e( 'This box, the title, the project image, the technology and the education levels are visible to every visitor.', 'robovalley-projects' ); ?></p>
	<table class="form-table rvp-fields" role="presentation">
		<tr>
			<th scope="row"><label for="rvp_short_desc"><?php esc_html_e( 'Short description', 'robovalley-projects' ); ?></label></th>
			<td>
				<textarea name="rvp_short_desc" id="rvp_short_desc" rows="2" maxlength="200" class="large-text"><?php echo esc_textarea( $desc ); ?></textarea>
				<p class="description"><?php esc_html_e( 'One or two sentences for the project card. Maximum 200 characters.', 'robovalley-projects' ); ?></p>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="rvp_difficulty"><?php esc_html_e( 'Difficulty', 'robovalley-projects' ); ?></label></th>
			<td>
				<select name="rvp_difficulty" id="rvp_difficulty">
					<option value=""><?php esc_html_e( '— Select —', 'robovalley-projects' ); ?></option>
					<?php foreach ( rvp_difficulties() as $value => $label ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $difficulty, $value ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</td>
		</tr>
		<tr>
			<th scope="row"><?php esc_html_e( 'Featured', 'robovalley-projects' ); ?></th>
			<td>
				<label for="rvp_featured">
					<input type="checkbox" name="rvp_featured" id="rvp_featured" value="1" <?php checked( $featured ); ?>>
					<?php esc_html_e( 'Show in the Featured tab', 'robovalley-projects' ); ?>
				</label>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="rvp_order"><?php esc_html_e( 'Display order', 'robovalley-projects' ); ?></label></th>
			<td>
				<input type="number" name="rvp_order" id="rvp_order" value="<?php echo esc_attr( $order ); ?>" min="0" step="1" class="small-text">
				<p class="description"><?php esc_html_e( 'Optional. Lower numbers are shown first; empty counts as 0. Projects with the same number are shown newest first.', 'robovalley-projects' ); ?></p>
			</td>
		</tr>
	</table>
	<?php
}

function rvp_render_details_box( $post ) {
	wp_nonce_field( 'rvp_save_details_' . $post->ID, 'rvp_nonce_details' );
	$rows = array(
		'_rvp_overview'   => array( 'rvp_overview', __( 'Overview', 'robovalley-projects' ), 6, __( 'What the project is and what the student will build.', 'robovalley-projects' ) ),
		'_rvp_skills'     => array( 'rvp_skills', __( 'Skills required', 'robovalley-projects' ), 4, __( 'One skill per line.', 'robovalley-projects' ) ),
		'_rvp_components' => array( 'rvp_components', __( 'Components required', 'robovalley-projects' ), 4, __( 'One component per line.', 'robovalley-projects' ) ),
		'_rvp_outcome'    => array( 'rvp_outcome', __( 'Expected outcome', 'robovalley-projects' ), 4, __( 'What the student will have achieved at the end.', 'robovalley-projects' ) ),
	);
	?>
	<p class="description"><strong><?php esc_html_e( 'Only signed-in RoboValley members can see these fields,', 'robovalley-projects' ); ?></strong> <?php esc_html_e( 'as do the Subjects. They are never part of the public page.', 'robovalley-projects' ); ?></p>
	<table class="form-table rvp-fields" role="presentation">
		<?php foreach ( $rows as $key => $row ) : ?>
			<tr>
				<th scope="row"><label for="<?php echo esc_attr( $row[0] ); ?>"><?php echo esc_html( $row[1] ); ?></label></th>
				<td>
					<textarea name="<?php echo esc_attr( $row[0] ); ?>" id="<?php echo esc_attr( $row[0] ); ?>" rows="<?php echo esc_attr( $row[2] ); ?>" class="large-text"><?php echo esc_textarea( (string) get_post_meta( $post->ID, $key, true ) ); ?></textarea>
					<p class="description"><?php echo esc_html( $row[3] ); ?></p>
				</td>
			</tr>
		<?php endforeach; ?>
	</table>
	<?php
}

/** Form field name => meta key, per box. */
function rvp_box_fields( $box ) {
	if ( 'summary' === $box ) {
		return array(
			'rvp_short_desc' => '_rvp_short_desc',
			'rvp_difficulty' => '_rvp_difficulty',
			'rvp_featured'   => '_rvp_featured',
			'rvp_order'      => '_rvp_order',
		);
	}
	return array(
		'rvp_overview'   => '_rvp_overview',
		'rvp_skills'     => '_rvp_skills',
		'rvp_components' => '_rvp_components',
		'rvp_outcome'    => '_rvp_outcome',
	);
}

add_action(
	'save_post_' . RVP_POST_TYPE,
	function ( $post_id ) {
		if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}
		foreach ( array( 'summary', 'details' ) as $box ) {
			$nonce_name = 'rvp_nonce_' . $box;
			// phpcs:ignore WordPress.Security.NonceVerification.Missing -- this IS the nonce check.
			if ( ! isset( $_POST[ $nonce_name ] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST[ $nonce_name ] ) ), 'rvp_save_' . $box . '_' . $post_id ) ) {
				continue;
			}
			foreach ( rvp_box_fields( $box ) as $field => $meta_key ) {
				// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.
				$raw   = isset( $_POST[ $field ] ) ? wp_unslash( $_POST[ $field ] ) : ''; // sanitized by rvp_sanitize_meta().
				$clean = rvp_sanitize_meta( $meta_key, $raw );
				if ( '' === $clean ) {
					delete_post_meta( $post_id, $meta_key );
				} else {
					update_post_meta( $post_id, $meta_key, $clean );
				}
			}
		}
	}
);

// Admin stylesheet on the project list and editor screens.
add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php', 'edit.php' ), true ) ) {
			return;
		}
		$screen = get_current_screen();
		if ( $screen && RVP_POST_TYPE === $screen->post_type ) {
			wp_enqueue_style( 'rvp-admin', RVP_URL . 'assets/rvp-admin.css', array(), RVP_VERSION );
		}
	}
);
