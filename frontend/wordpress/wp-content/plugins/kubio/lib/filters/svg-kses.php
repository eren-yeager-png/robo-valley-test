<?php

/**
 * Widens the kses element list so the SVG markup Kubio renders through
 * wp_kses_post() -- the plugin logo, block icons, shape dividers -- survives
 * sanitisation, since WordPress' own post list carries no SVG elements.
 *
 * WordPress runs this filter for every context it sanitises in, not just the
 * one the widening was written for: comment content, user profile fields and
 * any explicit element list passed to wp_kses() all pass through here too.
 * Those must keep WordPress' own restrictive list, so everything except 'post'
 * is returned untouched -- an anonymous commenter storing one of these
 * elements, with its data-* attributes intact, is a stored XSS vector.
 *
 * Kubio only ever needs the wider set where it calls wp_kses_post() or asks
 * for wp_kses_allowed_html( 'post' ) itself, which is the 'post' context.
 *
 * @param array  $allowed_html Elements, and the attributes allowed on them.
 * @param string $context      Context the sanitisation is running in.
 * @return array
 */
function kubio_get_svg_kses_allowed_elements( $allowed_html = array(), $context = '' ) {

	if ( 'post' !== $context ) {
		return $allowed_html;
	}

	$svg_elements = array(
		'svg'     =>
		array(
			'xmlns',
			'viewbox',
			'id',
			'data-name',
			'width',
			'height',
			'version',
			'xmlns:xlink',
			'x',
			'y',
			'enable-background',
			'xml:space',
		),
		'path'    =>
		array(
			'd',
			'id',
			'class',
			'data-name',
		),
		'g'       =>
		array(
			'id',
			'stroke',
			'stroke-width',
			'fill',
			'fill-rule',
			'transform',
		),
		'title'   =>
		array(),
		'polygon' =>
		array(
			'id',
			'points',
		),
		'rect'    =>
		array(
			'x',
			'y',
			'width',
			'height',
			'transform',
		),
		'circle'  =>
		array(
			'cx',
			'cy',
			'r',
		),
		'ellipse' =>
		array(
			'cx',
			'cy',
			'rx',
			'ry',
		),
	);

	$shared_attrs = array( 'data-*', 'id', 'class' );

	foreach ( $svg_elements as $element => $attrs ) {
		if ( ! isset( $allowed_html[ $element ] ) ) {
			$allowed_html[ $element ] = array();
		}

		$allowed_html[ $element ] = array_merge( $allowed_html[ $element ], array_fill_keys( array_merge( $attrs, $shared_attrs ), true ) );
	}

	return $allowed_html;
}

add_filter( 'wp_kses_allowed_html', 'kubio_get_svg_kses_allowed_elements', 10, 2 );
