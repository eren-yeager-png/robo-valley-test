/* RoboValley Projects: image chooser on the Technology Category screens. */
( function ( $ ) {
	'use strict';

	function setImage( $picker, id, url ) {
		$picker.find( '.rvp-image-id' ).val( id || '' );
		var $preview = $picker.find( '.rvp-image-preview' ).empty();
		if ( url ) {
			$( '<img>', { src: url, alt: '' } ).appendTo( $preview );
		}
		$picker.find( '.rvp-image-remove' ).prop( 'hidden', ! id );
	}

	/** One Media Library frame per picker, created on first use. */
	function frameFor( $picker ) {
		var frame = $picker.data( 'rvpFrame' );
		if ( frame ) {
			return frame;
		}
		frame = wp.media( { title: 'Choose image', button: { text: 'Use this image' }, library: { type: 'image' }, multiple: false } );
		frame.on( 'select', function () {
			var a = frame.state().get( 'selection' ).first().toJSON();
			var url = ( a.sizes && a.sizes.thumbnail ) ? a.sizes.thumbnail.url : a.url;
			setImage( $picker, a.id, url );
		} );
		// WordPress opens on the Upload tab until the library has loaded; show the library as soon as it has images.
		frame.on( 'open', function () {
			var library = frame.state().get( 'library' );
			library.more().always( function () {
				if ( library.length ) {
					frame.content.mode( 'browse' );
				}
			} );
		} );
		$picker.data( 'rvpFrame', frame );
		return frame;
	}

	$( document ).on( 'click', '.rvp-image-choose', function ( e ) {
		e.preventDefault();
		frameFor( $( this ).closest( '.rvp-image-picker' ) ).open();
	} );

	$( document ).on( 'click', '.rvp-image-remove', function ( e ) {
		e.preventDefault();
		setImage( $( this ).closest( '.rvp-image-picker' ), 0, '' );
	} );

	// After a category is added with the on-page form (AJAX), WordPress clears the text fields only: reset the rest too.
	$( document ).ajaxSuccess( function ( event, xhr, settings ) {
		if ( settings && typeof settings.data === 'string' && settings.data.indexOf( 'action=add-tag' ) !== -1 ) {
			var $form = $( '#addtag' );
			$form.find( '.rvp-image-picker' ).each( function () {
				setImage( $( this ), 0, '' );
			} );
			$form.find( '#rvp_order' ).val( 0 );
			$form.find( '#rvp_show_empty' ).prop( 'checked', false );
		}
	} );
}( jQuery ) );
