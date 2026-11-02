<?php

function kubio_get_template_types() {
	$template_types = kubio_get_template_type_slugs();
	$template_types = array_merge( $template_types, array( 'archive-product', 'single-product' ) );

	return $template_types;
}

function kubio_is_block_template() {
	global $_wp_current_template_content;

	return apply_filters( 'kubio_is_block_template', ! ! $_wp_current_template_content );
}

function kubio_theme_has_kubio_block_support() {
	return apply_filters( 'kubio/has_block_templates_support', false );
}

function kubio_theme_has_block_templates_support() {
	$folders_to_check = array( 'full-site-editing/block-templates/index.html', 'block-templates/index.html', 'templates/index.html' );

	$stylesheet_dir = get_stylesheet_directory();
	$parent_dir     = get_template_directory();

	foreach ( $folders_to_check as $folder ) {
		$candidate        = $stylesheet_dir . '/' . $folder;
		$candidate_parent = $parent_dir . '/' . $folder;
		if ( file_exists( $candidate ) ) {
			return true;
		}

		if ( $candidate_parent !== $candidate && file_exists( $candidate_parent ) ) {
			return true;
		}
	}

	return kubio_theme_has_kubio_block_support();
}

// skip unrelated templates to display
function kubio_skip_unrelated_templates( $post_templates, $theme, $post, $post_type ) {

	$exclude = array();

	switch ( $post_type ) {
		case 'page':
			$exclude[] = 'page';
			break;
	}

	$default_template_types = array_diff( array_keys( kubio_get_default_template_types() ), $exclude );

	foreach ( $post_templates as $slug => $name ) {
		if ( in_array( $slug, $default_template_types ) ) {
			unset( $post_templates[ $slug ] );
		}
	}

	return $post_templates;
}

add_filter(
	'theme_templates',
	'kubio_skip_unrelated_templates',
	100,
	4
);

// view and edit the slug in quick settings

function kubio_template_slug_editor( $column_name, $post_type ) {
	if ( $column_name === 'slug' && $post_type === 'wp_template' ) {
		?>
		<fieldset class="inline-edit-col-left">
			<div class="inline-edit-col">
				<div class="inline-edit-group wp-clearfix">
					<label class="inline-edit-status alignleft">
						<span class="title"><?php esc_html_e( 'Slug', 'kubio' ); ?></span>
						<span class="input-text-wrap"><input type="text" name="post_name" value="" /></span>
					</label>
				</div>
			</div>
		</fieldset>
		<?php
	}
}
