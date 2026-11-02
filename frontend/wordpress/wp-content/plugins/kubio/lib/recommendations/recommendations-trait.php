<?php


namespace Kubio\Blocks;

use IlluminateAgnostic\Arr\Support\Arr;
use Kubio\AssetsDependencyInjector;
use Kubio\Core\LodashBasic;
use Kubio\Core\Utils;

trait RecommendationsTrait {


	public function getRecommendationLinkAttributes() {
		$link           = $this->getAttribute( 'link' );
		$linkType       = $this->getAttribute( 'linkType' );
		$newsletter     = $this->getAttribute( 'recommendation.newsletter' );
		$recommendation = $this->getAttribute( 'recommendation' );

		switch ( $linkType ) {
			case 'phone':
				$phoneNrOld = $this->getAttribute( 'recommendation.bubbleChat.phone.phoneNr' );
				$phoneNr = $this->getAttribute( 'recommendation.siteleads.phone.phoneNr' );

				if(!empty($phoneNrOld) && empty($phoneNr)) {
					$phoneNr = $phoneNrOld;
				}
				$linkValue = '#';
				if ( ! empty( $phoneNr ) ) {
					$linkValue = 'tel:' . $phoneNr;
				}

				$attributes = Utils::getLinkAttributes(
					array(
						'value'        => $linkValue,
						'typeOpenLink' => 'sameWindow',
					)
				);
				break;
			case 'whatsapp':
				$phoneNrOld = $this->getAttribute( 'recommendation.bubbleChat.whatsapp.phoneNr' );
				$phoneNr = $this->getAttribute( 'recommendation.siteleads.whatsapp.phoneNr' );

				if(!empty($phoneNrOld) && empty($phoneNr)) {
					$phoneNr = $phoneNrOld;
				}
				if ( ! empty( $phoneNr ) ) {
					$linkValue  = 'https://wa.me/' . $phoneNr;
					$attributes = Utils::getLinkAttributes(
						array(
							'value'        => $linkValue,
							'typeOpenLink' => 'newWindow',
						)
					);
				} else {
					$attributes = Utils::getLinkAttributes(
						array(
							'value'        => '',
							'typeOpenLink' => 'sameWindow',
						)
					);
				}

				break;
			case 'newsletter':
				$newsletterId = LodashBasic::get( $newsletter, 'id' );

				$attributes = Utils::getLinkAttributes(
					array(
						'value'        => '',
						'typeOpenLink' => 'sameWindow',
					)
				);

				if ( ! empty( $newsletterId ) ) {
					$attributes[ "data-kubio-email-capture-popup-$newsletterId" ] = '1';
				}

				break;
			case 'contact-form':
				$id = Arr::get( $recommendation, 'contactForm.recommendationPageId' );

				$attributes = Utils::getLinkAttributes(
					array(
						'value'        => '',
						'typeOpenLink' => 'sameWindow',
					)
				);

				if ( ! empty( $id ) ) {
					$attributes['data-open-recommendation-page-iframe-in-lightbox'] = $this->getRecommendationPageIdForOpenIframeLightbox( $id );
				}
				break;
			case 'fluent-booking':
				$id = Arr::get( $recommendation, 'fluentBooking.recommendationPageId' );

				$attributes = Utils::getLinkAttributes(
					array(
						'value'        => '',
						'typeOpenLink' => 'sameWindow',
					)
				);

				if ( ! empty( $id ) ) {
					$attributes['data-open-recommendation-page-iframe-in-lightbox'] = $this->getRecommendationPageIdForOpenIframeLightbox( $id );
				}

				break;

			default:
				$attributes = Utils::getLinkAttributes( $link );

		}

		if ( $this->shouldDisplayAsFancyBoxForRecommendations() ) {
			$attributes['data-type'] = $this->getAttribute( 'link.lightboxMedia' );
			AssetsDependencyInjector::injectKubioFrontendStyleDependencies( 'fancybox' );
			AssetsDependencyInjector::injectKubioScriptDependencies( 'fancybox' );
		}

		return $attributes;
	}



	public function getRecommendationPageIframeHtml() {
		$linkType       = $this->getAttribute( 'linkType' );
		$recommendation = $this->getAttribute( 'recommendation' );

		$supported_link_types = array( 'contact-form', 'fluent-booking' );
		if ( ! in_array( $linkType, $supported_link_types ) ) {
			return null;
		}

		$recommendation_page_id = null;
		switch ( $linkType ) {
			case 'contact-form':
				$recommendation_page_id = Arr::get( $recommendation, 'contactForm.recommendationPageId' );

				break;
			case 'fluent-booking':
				$recommendation_page_id = Arr::get( $recommendation, 'fluentBooking.recommendationPageId' );

				break;

		}

		if ( empty( $recommendation_page_id ) ) {
			return null;
		}
		$recommendation_page_url = get_permalink( $recommendation_page_id );

		if ( empty( $recommendation_page_url ) ) {
			return null;
		}

		$iframe_wrapper_id = $this->getRecommendationPageIdForOpenIframeLightbox( $recommendation_page_id );

		ob_start();
		?>
		<div class="kubio-recommendation-page-iframe__wrapper"
			id="<?php echo esc_attr( $iframe_wrapper_id ); ?>"

		>
			<span class="kubio-recommendation-page-iframe__close">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
					<!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.-->
					<path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/>
				</svg>
			</span>
			<iframe src="<?php echo esc_url( $recommendation_page_url ); ?>" ></iframe>
		</div>
		<?php
		$inner_html = ob_get_clean();
		return array(
			'innerHTML' => $inner_html,
		);
	}

	public function shouldDisplayAsFancyBoxForRecommendations() {
		$openType = $this->getAttribute( 'link.typeOpenLink' );

		return $openType === 'lightbox';
	}

	public function getRecommendationPageIdForOpenIframeLightbox( $id ) {
		$linkType = $this->getAttribute( 'linkType' );

		switch ( $linkType ) {
			case 'contact-form':
			case 'fluent-booking':
				$iframeId = "kubio-recommendation-page-{$id}";
				break;
			default:
				return null;
		}

		return $iframeId;
	}
}
