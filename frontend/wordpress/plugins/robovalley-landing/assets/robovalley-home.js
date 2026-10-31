/**
 * RoboValley homepage: home slider and chart tooltips.
 *
 * The slides, their text and images live in the page's HTML widget; this script
 * only adds the city map, tabs and controls. Without it the first slide shows.
 * It never runs inside the Elementor editor.
 */
( function () {
	'use strict';

	function inElementorEditor() {
		if ( /[?&]elementor-preview=/.test( window.location.search ) ) {
			return true;
		}
		if ( document.body.classList.contains( 'elementor-editor-active' ) ) {
			return true;
		}
		if ( window.elementorFrontend && typeof window.elementorFrontend.isEditMode === 'function' && window.elementorFrontend.isEditMode() ) {
			return true;
		}
		try {
			if ( window.parent !== window && window.parent.elementor ) {
				return true;
			}
		} catch ( e ) {
			// Cross-origin parent: not the Elementor editor.
		}
		return false;
	}

	var ZONE_COLOURS = {
		brand: 'var(--rh-brand)',
		amber: 'var(--rh-amber)',
		z1: 'var(--rh-z1)',
		z2: 'var(--rh-z2)',
		z3: 'var(--rh-z3)',
		z4: 'var(--rh-z4)',
		z5: 'var(--rh-z5)',
		z6: 'var(--rh-z6)',
	};

	function el( tag, className, html ) {
		var node = document.createElement( tag );
		if ( className ) {
			node.className = className;
		}
		if ( html ) {
			node.innerHTML = html;
		}
		return node;
	}

	function initSlider( root ) {
		var stage = root.querySelector( '.robovalley-stage' );
		var slides = Array.prototype.slice.call( root.querySelectorAll( '.robovalley-slide' ) );
		if ( ! stage || slides.length < 2 ) {
			return;
		}

		var duration = parseInt( root.getAttribute( 'data-duration' ), 10 ) || 6500;
		var reduceMotion = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		var cur = 0;
		var elapsed = 0;
		var last = performance.now();
		var hovering = false;
		var paused = reduceMotion;

		// City map: main city button, then one hexagon per zone slide.
		var map = el( 'nav', 'robovalley-citymap' );
		map.setAttribute( 'aria-label', 'City map: RoboCity and its six zones' );
		var city = el( 'button', 'robovalley-cm-city', slides[ 0 ].getAttribute( 'data-name' ) + ' <small>MAIN CITY</small>' );
		city.type = 'button';
		var row = el( 'div', 'robovalley-cm-row' );
		map.appendChild( city );
		map.appendChild( el( 'div', 'robovalley-cm-stem' ) );
		map.appendChild( row );
		stage.appendChild( map );

		var cells = [];
		slides.forEach( function ( slide, i ) {
			var zc = ZONE_COLOURS[ slide.getAttribute( 'data-zc' ) ] || ZONE_COLOURS.brand;
			slide.style.setProperty( '--rh-zc', zc );
			if ( i === 0 ) {
				return;
			}
			var cell = el( 'div', 'robovalley-cm-cell' );
			cell.style.setProperty( '--rh-zc', zc );
			var hex = el( 'button', 'robovalley-cm-hex', '<span><b></b></span>' );
			hex.type = 'button';
			hex.querySelector( 'b' ).textContent = slide.getAttribute( 'data-code' );
			hex.title = slide.getAttribute( 'data-name' );
			hex.setAttribute( 'aria-label', 'Zone ' + i + ': ' + slide.getAttribute( 'data-name' ) );
			hex.addEventListener( 'click', function () { go( i ); } );
			cell.appendChild( hex );
			row.appendChild( cell );
			cells.push( cell );
		} );
		city.addEventListener( 'click', function () { go( 0 ); } );

		// Controls above the stage (directly under the site header): prev, tabs with progress, next, pause.
		var controls = el( 'div', 'robovalley-controls' );
		var prev = el( 'button', 'robovalley-arrow', '←' );
		prev.type = 'button';
		prev.setAttribute( 'aria-label', 'Previous slide' );
		var next = el( 'button', 'robovalley-arrow', '→' );
		next.type = 'button';
		next.setAttribute( 'aria-label', 'Next slide' );
		var tabs = el( 'div', 'robovalley-tabs' );
		tabs.setAttribute( 'role', 'tablist' );
		var pause = el( 'button', 'robovalley-pause' );
		pause.type = 'button';

		var tabEls = slides.map( function ( slide, i ) {
			var tab = el( 'button', 'robovalley-tab' );
			tab.type = 'button';
			tab.setAttribute( 'role', 'tab' );
			tab.style.setProperty( '--rh-zc', i ? ZONE_COLOURS[ slide.getAttribute( 'data-zc' ) ] : ZONE_COLOURS.brand );
			var small = el( 'small' );
			small.textContent = i ? slide.getAttribute( 'data-code' ) : 'HOME';
			tab.appendChild( small );
			tab.appendChild( document.createTextNode( slide.getAttribute( 'data-tab' ) || slide.getAttribute( 'data-name' ) ) );
			tab.appendChild( el( 'span', 'robovalley-tab-prog' ) );
			tab.addEventListener( 'click', function () { go( i, true ); } );
			tabs.appendChild( tab );
			return tab;
		} );

		controls.appendChild( prev );
		controls.appendChild( tabs );
		controls.appendChild( next );
		controls.appendChild( pause );
		root.insertBefore( controls, stage );

		function go( n, fromTab ) {
			cur = ( n + slides.length ) % slides.length;
			elapsed = 0;
			slides.forEach( function ( slide, i ) {
				var on = i === cur;
				slide.classList.toggle( 'is-active', on );
				slide.setAttribute( 'aria-hidden', on ? 'false' : 'true' );
			} );
			cells.forEach( function ( cell, i ) {
				var on = cur === i + 1;
				cell.classList.toggle( 'is-on', on );
				cell.classList.toggle( 'is-lit', cur === 0 );
				cell.querySelector( 'button' ).setAttribute( 'aria-current', on ? 'true' : 'false' );
			} );
			city.classList.toggle( 'is-on', cur === 0 );
			city.setAttribute( 'aria-current', cur === 0 ? 'true' : 'false' );
			tabEls.forEach( function ( tab, i ) {
				tab.setAttribute( 'aria-selected', i === cur ? 'true' : 'false' );
				tab.querySelector( '.robovalley-tab-prog' ).style.width = '0';
			} );
			if ( fromTab ) {
				tabs.scrollTo( { left: tabEls[ cur ].offsetLeft - tabs.offsetLeft - 40, behavior: reduceMotion ? 'auto' : 'smooth' } );
			}
		}

		function setPaused( p ) {
			paused = p;
			pause.textContent = p ? 'Play' : 'Pause';
			pause.setAttribute( 'aria-pressed', p ? 'true' : 'false' );
		}

		function loop( now ) {
			var dt = now - last;
			last = now;
			if ( ! paused && ! hovering && ! document.hidden ) {
				elapsed += dt;
				if ( elapsed >= duration ) {
					go( cur + 1 );
				}
			}
			tabEls[ cur ].querySelector( '.robovalley-tab-prog' ).style.width = ( paused ? 0 : Math.min( elapsed / duration, 1 ) * 100 ) + '%';
			window.requestAnimationFrame( loop );
		}

		pause.addEventListener( 'click', function () {
			setPaused( ! paused );
			elapsed = 0;
		} );
		prev.addEventListener( 'click', function () { go( cur - 1 ); } );
		next.addEventListener( 'click', function () { go( cur + 1 ); } );
		stage.addEventListener( 'mouseenter', function () { hovering = true; } );
		stage.addEventListener( 'mouseleave', function () { hovering = false; } );
		stage.addEventListener( 'focusin', function () { hovering = true; } );
		stage.addEventListener( 'focusout', function () { hovering = false; } );
		root.addEventListener( 'keydown', function ( e ) {
			if ( e.target.closest( 'input, textarea, select' ) ) {
				return;
			}
			if ( e.key === 'ArrowRight' ) {
				go( cur + 1 );
			} else if ( e.key === 'ArrowLeft' ) {
				go( cur - 1 );
			}
		} );

		var startX = null;
		stage.addEventListener( 'touchstart', function ( e ) { startX = e.touches[ 0 ].clientX; }, { passive: true } );
		stage.addEventListener( 'touchend', function ( e ) {
			if ( startX === null ) {
				return;
			}
			var dx = e.changedTouches[ 0 ].clientX - startX;
			if ( Math.abs( dx ) > 40 ) {
				go( cur + ( dx < 0 ? 1 : -1 ) );
			}
			startX = null;
		} );

		setPaused( paused );
		go( 0 );
		window.requestAnimationFrame( loop );
	}

	function initTooltips( box ) {
		var tip = el( 'div', 'robovalley-tip' );
		tip.hidden = true;
		box.appendChild( tip );
		box.addEventListener( 'mousemove', function ( e ) {
			var g = e.target.closest( '[data-tip]' );
			if ( ! g ) {
				tip.hidden = true;
				return;
			}
			var r = box.getBoundingClientRect();
			tip.textContent = g.getAttribute( 'data-tip' );
			tip.style.left = ( e.clientX - r.left ) + 'px';
			tip.style.top = ( e.clientY - r.top ) + 'px';
			tip.hidden = false;
		} );
		box.addEventListener( 'mouseleave', function () { tip.hidden = true; } );
	}

	/**
	 * Mark the header bars with Astra's own sticky marker. Astra's menu and
	 * arrival-from-another-page scrolling add the height of every marked bar to
	 * its offset, so headings land below the sticky header. Nothing styles it.
	 * Runs immediately (deferred script), before Astra's DOMContentLoaded handler.
	 */
	function markStickyHeader() {
		if ( ! window.CSS || ! CSS.supports( 'overflow', 'clip' ) ) {
			return; // Header is not sticky in this browser, so no offset is wanted.
		}
		document.querySelectorAll( '#masthead .main-header-bar-wrap' ).forEach( function ( bar ) {
			bar.setAttribute( 'data-stick-support', '' );
		} );
	}

	if ( ! inElementorEditor() ) {
		markStickyHeader();
	}

	function boot() {
		if ( inElementorEditor() ) {
			return;
		}
		document.querySelectorAll( '.robovalley-home .robovalley-slider' ).forEach( initSlider );
		document.querySelectorAll( '.robovalley-home .robovalley-cbox' ).forEach( initTooltips );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
}() );
