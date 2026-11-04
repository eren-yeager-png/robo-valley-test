<?php
/**
 * Term fields.
 *   All three taxonomies: "Display order" (rvp_order, lower first).
 *   Technology only: image / icon (rvp_image_id) and "Show even when it has no projects" (rvp_show_empty).
 * The description is WordPress's own term description.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Taxonomies that have the display-order field. */
function rvp_taxonomies() {
	return array( RVP_TAX_TECH, RVP_TAX_EDU, RVP_TAX_SUBJECT );
}

add_action(
	'init',
	function () {
		foreach ( rvp_taxonomies() as $taxonomy ) {
			register_term_meta(
				$taxonomy,
				'rvp_order',
				array(
					'type'              => 'integer',
					'single'            => true,
					'default'           => 0,
					'show_in_rest'      => false,
					'sanitize_callback' => 'absint',
					'auth_callback'     => function () {
						return current_user_can( 'manage_rv_project_terms' );
					},
				)
			);
		}
		register_term_meta(
			RVP_TAX_TECH,
			'rvp_image_id',
			array(
				'type'              => 'integer',
				'single'            => true,
				'default'           => 0,
				'show_in_rest'      => false,
				'sanitize_callback' => 'rvp_sanitize_image_id',
				'auth_callback'     => function () {
					return current_user_can( 'manage_rv_project_terms' );
				},
			)
		);
		register_term_meta(
			RVP_TAX_TECH,
			'rvp_show_empty',
			array(
				'type'              => 'boolean',
				'single'            => true,
				'default'           => false,
				'show_in_rest'      => false,
				'sanitize_callback' => 'rest_sanitize_boolean',
				'auth_callback'     => function () {
					return current_user_can( 'manage_rv_project_terms' );
				},
			)
		);
	}
);

/** An attachment id that really is an image, otherwise 0. */
function rvp_sanitize_image_id( $value ) {
	$id = absint( $value );
	return ( $id && wp_attachment_is_image( $id ) ) ? $id : 0;
}

/* ---------- Form fields ---------- */

foreach ( array( RVP_TAX_TECH, RVP_TAX_EDU, RVP_TAX_SUBJECT ) as $rvp_tax ) {
	add_action( "{$rvp_tax}_add_form_fields", 'rvp_term_add_fields' );
	add_action( "{$rvp_tax}_edit_form_fields", 'rvp_term_edit_fields', 10, 2 );
	add_action( "created_{$rvp_tax}", 'rvp_term_save' );
	add_action( "edited_{$rvp_tax}", 'rvp_term_save' );
}
unset( $rvp_tax );

function rvp_term_add_fields( $taxonomy ) {
	wp_nonce_field( 'rvp_term_meta', 'rvp_term_nonce' );
	?>
	<div class="form-field">
		<label for="rvp_order"><?php esc_html_e( 'Display order', 'robovalley-projects' ); ?></label>
		<input type="number" name="rvp_order" id="rvp_order" value="0" min="0" step="1" class="small-text">
		<p><?php esc_html_e( 'Lower numbers are shown first. Items with the same number are sorted by name.', 'robovalley-projects' ); ?></p>
	</div>
	<?php if ( RVP_TAX_TECH === $taxonomy ) : ?>
		<div class="form-field rvp-image-field">
			<label><?php esc_html_e( 'Image / icon', 'robovalley-projects' ); ?></label>
			<?php rvp_render_image_picker( 0 ); ?>
		</div>
		<div class="form-field">
			<label for="rvp_show_empty">
				<input type="checkbox" name="rvp_show_empty" id="rvp_show_empty" value="1">
				<?php esc_html_e( 'Show even when it has no projects', 'robovalley-projects' ); ?>
			</label>
			<p><?php esc_html_e( 'Categories without published projects are hidden on the Projects page unless this is ticked.', 'robovalley-projects' ); ?></p>
		</div>
	<?php endif; ?>
	<?php
}

function rvp_term_edit_fields( $term, $taxonomy ) {
	wp_nonce_field( 'rvp_term_meta', 'rvp_term_nonce' );
	$order = (int) get_term_meta( $term->term_id, 'rvp_order', true );
	?>
	<tr class="form-field">
		<th scope="row"><label for="rvp_order"><?php esc_html_e( 'Display order', 'robovalley-projects' ); ?></label></th>
		<td>
			<input type="number" name="rvp_order" id="rvp_order" value="<?php echo esc_attr( $order ); ?>" min="0" step="1" class="small-text">
			<p class="description"><?php esc_html_e( 'Lower numbers are shown first. Items with the same number are sorted by name.', 'robovalley-projects' ); ?></p>
		</td>
	</tr>
	<?php if ( RVP_TAX_TECH === $taxonomy ) : ?>
		<tr class="form-field rvp-image-field">
			<th scope="row"><label><?php esc_html_e( 'Image / icon', 'robovalley-projects' ); ?></label></th>
			<td><?php rvp_render_image_picker( (int) get_term_meta( $term->term_id, 'rvp_image_id', true ) ); ?></td>
		</tr>
		<tr class="form-field">
			<th scope="row"><?php esc_html_e( 'Empty category', 'robovalley-projects' ); ?></th>
			<td>
				<label for="rvp_show_empty">
					<input type="checkbox" name="rvp_show_empty" id="rvp_show_empty" value="1" <?php checked( (bool) get_term_meta( $term->term_id, 'rvp_show_empty', true ) ); ?>>
					<?php esc_html_e( 'Show even when it has no projects', 'robovalley-projects' ); ?>
				</label>
				<p class="description"><?php esc_html_e( 'Categories without published projects are hidden on the Projects page unless this is ticked.', 'robovalley-projects' ); ?></p>
			</td>
		</tr>
	<?php endif; ?>
	<?php
}

/** Image chooser: preview + hidden id field; rvp-admin.js opens the Media Library. */
function rvp_render_image_picker( $image_id ) {
	$preview = $image_id ? wp_get_attachment_image( $image_id, array( 96, 96 ), false, array( 'class' => 'rvp-image-preview-img' ) ) : '';
	?>
	<div class="rvp-image-picker">
		<div class="rvp-image-preview"><?php echo $preview; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_get_attachment_image output. ?></div>
		<input type="hidden" name="rvp_image_id" class="rvp-image-id" value="<?php echo esc_attr( $image_id ? $image_id : '' ); ?>">
		<button type="button" class="button rvp-image-choose"><?php esc_html_e( 'Choose image', 'robovalley-projects' ); ?></button>
		<button type="button" class="button-link rvp-image-remove"<?php echo $image_id ? '' : ' hidden'; ?>><?php esc_html_e( 'Remove', 'robovalley-projects' ); ?></button>
	</div>
	<?php
}

function rvp_term_save( $term_id ) {
	// phpcs:disable WordPress.Security.NonceVerification -- verified on the next line.
	if ( ! isset( $_POST['rvp_term_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['rvp_term_nonce'] ) ), 'rvp_term_meta' ) ) {
		return;
	}
	if ( ! current_user_can( 'manage_rv_project_terms' ) ) {
		return;
	}
	$term = get_term( $term_id );
	if ( ! $term || is_wp_error( $term ) || ! in_array( $term->taxonomy, rvp_taxonomies(), true ) ) {
		return;
	}
	if ( isset( $_POST['rvp_order'] ) ) {
		update_term_meta( $term_id, 'rvp_order', absint( wp_unslash( $_POST['rvp_order'] ) ) );
	}
	if ( RVP_TAX_TECH === $term->taxonomy ) {
		update_term_meta( $term_id, 'rvp_image_id', isset( $_POST['rvp_image_id'] ) ? absint( wp_unslash( $_POST['rvp_image_id'] ) ) : 0 );
		update_term_meta( $term_id, 'rvp_show_empty', isset( $_POST['rvp_show_empty'] ) ? 1 : 0 );
	}
	// phpcs:enable
}

/* ---------- Term list: show the order ---------- */

foreach ( array( RVP_TAX_TECH, RVP_TAX_EDU, RVP_TAX_SUBJECT ) as $rvp_tax ) {
	add_filter(
		"manage_edit-{$rvp_tax}_columns",
		function ( $columns ) {
			$columns['rvp_order'] = __( 'Order', 'robovalley-projects' );
			return $columns;
		}
	);
	add_filter(
		"manage_{$rvp_tax}_custom_column",
		function ( $content, $column, $term_id ) {
			return 'rvp_order' === $column ? (string) (int) get_term_meta( $term_id, 'rvp_order', true ) : $content;
		},
		10,
		3
	);
}
unset( $rvp_tax );

/* ---------- Admin assets (term screens of this plugin only) ---------- */

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( 'edit-tags.php' !== $hook && 'term.php' !== $hook ) {
			return;
		}
		$screen = get_current_screen();
		if ( ! $screen || ! in_array( $screen->taxonomy, rvp_taxonomies(), true ) ) {
			return;
		}
		wp_enqueue_style( 'rvp-admin', RVP_URL . 'assets/rvp-admin.css', array(), RVP_VERSION );
		if ( RVP_TAX_TECH === $screen->taxonomy ) {
			wp_enqueue_media();
			wp_enqueue_script( 'rvp-admin', RVP_URL . 'assets/rvp-admin.js', array( 'jquery' ), RVP_VERSION, true );
		}
	}
);
