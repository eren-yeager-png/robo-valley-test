function mediaModalInit() {
	// @ts-ignore
	const { __ } = wp.i18n;
	const getStaticAssetURL = ( rel ) => {
		// @ts-ignore
		const path = top.kubioUtilsData?.staticAssetsURL;
		return path ? `${ path }/${ rel.replace( /^\/|\/$/g, '' ) }` : null;
	};

	const imageHubSvgUrl = getStaticAssetURL(
		'admin-pages/image-hub-logo-color.svg'
	);

	// @ts-ignore
	top.imageHubMediaTabInited = true;
	top.imageHubMediaTabInitedFromKubio = true;
	const getNewMediaTabObject = ( FrameSelect ) => {
		return {
			initialize() {
				FrameSelect.prototype.initialize.apply( this, arguments );

				const CustomState = wp.media.controller.State.extend( {
					insert() {
						this.frame.close();
					},
				} );

				this.states.add( [
					new CustomState( {
						id: 'demo-image-hub-media-modal-tab',
						search: false,
						title: __( 'Free Images', 'kubio' ),
					} ),
				] );

				this.on(
					'content:render:image-hub-media-modal-tab-content',
					this.renderContent,
					this
				);
				const self = this;

				const onReInsertBrowserButtonIfNeeded = () => {
					const node = self?.$el?.[ 0 ];
					if ( ! node ) {
						return;
					}
					let browserButton = node.querySelector( 'button.browser' );
					if ( browserButton ) {
						return;
					}
					browserButton = document.createElement( 'button' );

					const buttonParent = node.querySelector( '.upload-ui' );
					if ( ! buttonParent ) {
						return;
					}

					buttonParent.appendChild( browserButton );

					browserButton.outerHTML =
						'<button type="button" class="browser button button-hero" style="position: relative; z-index: 1;" id="__wp-uploader-id-1" aria-labelledby="__wp-uploader-id-1 post-upload-info">Select Files</button>';
				};
				this.on( 'ready', onReInsertBrowserButtonIfNeeded );
				//adds the icon to the tab
				this.on( 'router:create:browse', function ( routerView ) {
					const onSelectBrowseButtonIfImageHubActive = ( {
						parentNode,
						imageHubTabNode,
					} ) => {
						if ( imageHubTabNode.classList.contains( 'active' ) ) {
							const browseButton =
								parentNode.querySelector( '#menu-item-browse' );
							if ( browseButton ) {
								browseButton.click();
							}
						}
					};

					// Wait for next tick so DOM is rendered
					setTimeout( () => {
						const libraryType =
							self?.options?.library?.type?.[ 0 ] || 'image';
						const isImage = libraryType === 'image';

						const node = routerView?.view?.$el?.[ 0 ];
						if ( ! node ) {
							return;
						}
						const imageHubTabNode = node.querySelector(
							'#menu-item-image-hub-media-modal-tab-content'
						);
						if ( ! imageHubTabNode ) {
							return;
						}
						imageHubTabNode.setAttribute(
							'data-type',
							libraryType
						);
						if ( ! isImage ) {
							onSelectBrowseButtonIfImageHubActive( {
								imageHubTabNode,
								parentNode: node,
							} );
							return;
						}

						const shouldOpenImageHubTab =
							top.kubioOpenImageHubOnNextOpenedMediaPicker;
						top.kubioOpenImageHubOnNextOpenedMediaPicker = false;
						if ( shouldOpenImageHubTab ) {
							imageHubTabNode.click();
						} else {
							//if the media picker is opened and the active tab is image hub but the free
							//images was not used pick the media library
							onSelectBrowseButtonIfImageHubActive( {
								imageHubTabNode,
								parentNode: node,
							} );
						}

						const svgParent = document.createElement( 'div' );
						svgParent.innerHTML = `<img height="20px"  width="20px" src="${ imageHubSvgUrl }" alt="Image Hub">`;

						imageHubTabNode.prepend( svgParent );
					}, 10 );
				} );
			},

			browseRouter( routerView ) {
				FrameSelect.prototype.browseRouter.apply( this, arguments );

				routerView.set( {
					'image-hub-media-modal-tab-content': {
						text: __( 'Free Images', 'kubio' ),
						priority: 120,
					},
				} );
			},

			renderContent() {
				const CustomView = wp.media.View.extend( {
					tagName: 'div',
					className: 'demo-image-hub-media-modal-tab',
					render() {
						this.$el.empty();
						renderHTMLContent( this.el ); // Inject your custom content
						return this;
					},
				} );

				const view = new CustomView();
				this.content.set( view );
			},
		};
	};

	const MediaFrameSelect = wp.media.view.MediaFrame.Select;

	wp.media.view.MediaFrame.Select = MediaFrameSelect.extend(
		getNewMediaTabObject( MediaFrameSelect )
	);

	const MediaFramePost = wp.media.view.MediaFrame.Post;

	wp.media.view.MediaFrame.Post = MediaFramePost.extend(
		getNewMediaTabObject( MediaFramePost )
	);

	let imageHubInstalled = false;

	function renderHTMLContent() {
		setTimeout( () => {
			const mediaLibraryRoot = document.querySelector(
				'.demo-image-hub-media-modal-tab'
			);
			if ( ! mediaLibraryRoot ) {
				return;
			}

			if ( ! imageHubInstalled ) {
				renderHTMLContentWithoutPlugin( mediaLibraryRoot );
			} else {
				renderHTMLContentWithPlugin( mediaLibraryRoot );
			}
		}, 10 );
	}
	function renderHTMLContentWithPlugin( mediaLibraryRoot ) {
		const rootDiv = document.createElement( 'div' );
		rootDiv.setAttribute( 'id', 'demo-image-hub-media-modal-root' );
		mediaLibraryRoot.appendChild( rootDiv );
		// @ts-ignore
		const imageHubMediaTabReactApp = top.imageHubMediaTabReactApp;
		if ( ! imageHubMediaTabReactApp ) {
			return;
		}
		imageHubMediaTabReactApp( rootDiv );
	}

	const fetchImageHubAssets = async () => {
		return new Promise( ( resolve, reject ) => {
			// @ts-ignore
			const { loadAssetsFromGutenberg } = top?.kubio?.utils || {};
			if ( ! loadAssetsFromGutenberg ) {
				reject( 'Could not find loadAssetsFromGutenberg function ' );
				return;
			}
			const onAssetsLoaded = () => {
				resolve();
			};

			loadAssetsFromGutenberg( {
				pluginIdString: 'image-hub',
				pluginUrlString: 'image-hub',
				onAssetsLoaded,
			} );
		} );
	};

	const onRenderImageHubAfterInstall = () => {
		const container = document.querySelector(
			'.demo-image-hub-media-modal-tab'
		);
		if ( ! container ) {
			return;
		}

		container.innerHTML = '';
		renderHTMLContentWithPlugin( container );
	};
	const onImageHubInstalled = async () => {
		try {
			imageHubInstalled = true;
			await fetchImageHubAssets();
			onRenderImageHubAfterInstall();
		} catch ( e ) {
			console.error( e );
			alert( __( 'Encountered error on install', 'kubio' ) );
		}
	};

	function renderHTMLContentWithoutPlugin( mediaLibraryRoot ) {
		const content = `
        <div class="demo-image-hub-centered-container">
            <img src="${ getStaticAssetURL(
				'admin-pages/image-hub-logo-color.svg'
			) }" />
            <h1>${ __(
				'Image Hub - Free images from Unsplash, Pexels, Pixabay and more',
				'kubio'
			) }</h1>
            <p>
                ${ __( 'Search and insert images from', 'kubio' ) }
                <a href="https://unsplash.com" target="_blank">${ __(
					'Unsplash',
					'kubio'
				) }</a>,
                <a href="https://openverse.org" target="_blank">${ __(
					'Openverse',
					'kubio'
				) }</a>,
                <a href="https://pixabay.com" target="_blank">${ __(
					'Pixabay',
					'kubio'
				) }</a>,
                <a href="https://giphy.com" target="_blank">${ __(
					'Giphy',
					'kubio'
				) }</a>,
                ${ __( 'and', 'kubio' ) }
                <a href="https://www.pexels.com" target="_blank">${ __(
					'Pexels',
					'kubio'
				) }</a>
                ${ __(
					'directly in WordPress. No need to visit external websites—find, preview, and download images straight from the media library or editor.',
					'kubio'
				) }
            </p>
            <button id="demo-image-hub-activate" class="components-button is-primary">${ __(
				'Install Image Hub Plugin',
				'kubio'
			) }</button>
        </div>
    `;

		mediaLibraryRoot.innerHTML = content;
		const button = mediaLibraryRoot.querySelector(
			'#demo-image-hub-activate'
		);
		let pendingInstalling = false;
		setTimeout( () => {
			function outerListener() {
				if ( pendingInstalling ) {
					return;
				}
				pendingInstalling = true;
				button.innerHTML = __( 'Installing…', 'kubio' );
				button.classList.add( 'is-busy' );
				// @ts-ignore
				wp.ajax
					.send( 'kubio-image-hub-install-plugin', {
						data: {
							// @ts-ignore
							_wpnonce: top?.kubioUtilsData?.kubio_ajax_nonce,
						},
						// @ts-ignore
					} )
					.done( function ( response ) {
						onImageHubInstalled();
						pendingInstalling = false;
					} )
					.fail( function ( error ) {
						console.error(
							'Error handling Instant Images plugin:',
							error
						);
						alert(
							__( 'Failed to install image hub plugin', 'kubio' )
						);
						pendingInstalling = false;
						button.classList.remove( 'is-busy' );
					} );
			}

			button.addEventListener( 'click', outerListener );
		}, 1 );
	}
}
const domReady = wp.domReady;

domReady( () => {
	if ( ! top.imageHubMediaTabInited ) {
		mediaModalInit();
	}
} );
