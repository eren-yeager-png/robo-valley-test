<?php

use Kubio\Core\Importer;
use Kubio\Core\Utils;

function kubio_rest_pre_insert_import_assets( $prepared_post ) {
	if ( ! current_user_can( 'upload_files' ) ) {
		return $prepared_post;
	}
	//if you make changes to the post that does not include it's content. For example featured image, template,
	// slug etc... . we need to stop the function or the post content will be removed
	if ( ! isset( $prepared_post->post_content ) ) {
		return $prepared_post;
	}
	$content = $prepared_post->post_content;

	$blocks = parse_blocks( $content );

	$blocks = Importer::maybeImportBlockAssets( $blocks );

	$blocks = apply_filters( 'kubio/rest-pre-save-post/import-assets', $blocks, $prepared_post );

	$prepared_post->post_content = kubio_serialize_blocks( $blocks );

	return $prepared_post;
}

function kubio_import_assets_filter() {
	$post_types = array( 'page', 'post', 'wp_template', 'wp_template_part' );

	foreach ( $post_types as $post_type ) {
		add_filter( "rest_pre_insert_{$post_type}", 'kubio_rest_pre_insert_import_assets' );
	}
}

add_action( 'init', 'kubio_import_assets_filter' );

//when in site editor mode disable import download
add_filter(
	'kubio/importer/skip-remote-file-import',
	function ( $result ) {
		if ( Utils::getIsAISiteEditor() ) {
			return true;
		}
		return $result;
	},
	9
);
