<?php

function kubio_render_block_template_part( $block, $slug, $style_ref = null ) {
	return render_block(
		array(
			'blockName'    => $block,
			'attrs'        =>
					array(
						'slug'  => $slug,
						'theme' => get_stylesheet(),
						'kubio' => array( 'styleRef' => $style_ref ? $style_ref : "kubio-{$slug}" ),

					),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		)
	);
}
