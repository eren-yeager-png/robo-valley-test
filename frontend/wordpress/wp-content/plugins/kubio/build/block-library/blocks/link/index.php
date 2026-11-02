<?php

namespace Kubio\Blocks;

use Kubio\Core\Blocks\BlockBase;
use Kubio\Core\Registry;

class LinkBlock extends BlockBase {
	use RecommendationsTrait;

	const OUTER = 'outer';
	const LINK = 'link';
	const TEXT = 'text';
	const ICON = 'icon';
	const RECOMMENDATION_PAGE_IFRAME = 'recommendationPageIframe';

	public function computed() {
		$show_icon     = $this->getProp( 'showIcon', false );
		$icon_position = $this->getProp( 'iconPosition', 'before' );
		$show_before   = $show_icon && $icon_position === 'before';
		$show_after    = $show_icon && $icon_position === 'after';

		return array(
			'showBeforeIcon' => $show_before,
			'showAfterIcon'  => $show_after,
		);
	}

	public function mapPropsToElements() {
		$icon_name = $this->getAttribute( 'icon.name' );
		$text      = $this->getBlockInnerHtml();

		return array(
			self::LINK => $this->getRecommendationLinkAttributes(),

			self::ICON => array(
				'name' => $icon_name,
			),

			self::TEXT => array(
				'innerHTML' => wp_kses_post( $text ),
			),

			self::RECOMMENDATION_PAGE_IFRAME => $this->getRecommendationPageIframeHtml()

		);
	}


}

Registry::registerBlock( __DIR__, LinkBlock::class );
