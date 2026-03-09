import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import '../../services/storage_service.dart';

/// 欧美女性专版付费墙
/// Elevate Your Presence Instantly / Unlock Elegant Mode
class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});

  @override
  ConsumerState<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  final PageController _pageController = PageController();
  ProductDetails? _product;
  bool _loading = true;
  bool _purchasing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProduct();
    ref.read(purchaseServiceProvider).addPurchaseListener(_onPurchased);
  }

  @override
  void dispose() {
    ref.read(purchaseServiceProvider).removePurchaseListener(_onPurchased);
    _pageController.dispose();
    super.dispose();
  }

  void _onPurchased(PurchaseDetails purchase) async {
    await StorageService.setFullReportUnlocked(true);
    ref.read(purchasedProvider.notifier).state = true;
    try {
      final uid = await ref.read(uidProvider.future);
      final token = purchase.verificationData.serverVerificationData;
      final productId = purchase.productID;
      if (uid.isNotEmpty && token.isNotEmpty && productId.isNotEmpty) {
        await ref.read(apiServiceProvider).verifyPurchase(
              uid: uid,
              purchaseToken: token,
              productId: productId,
            );
      }
    } catch (_) {}
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  Future<void> _loadProduct() async {
    final service = ref.read(purchaseServiceProvider);
    final available = await service.isAvailable();
    if (!available) {
      setState(() {
        _loading = false;
        _error = AppStrings.storeNotAvailable;
      });
      return;
    }
    final products = await service.getProducts();
    setState(() {
      _product = products.isNotEmpty ? products.first : null;
      _loading = false;
    });
  }

  Future<void> _purchase() async {
    if (_product == null) return;
    setState(() {
      _purchasing = true;
      _error = null;
    });
    try {
      await ref.read(purchaseServiceProvider).buyConsumable(_product!);
    } catch (e) {
      setState(() {
        _error = e.toString();
        _purchasing = false;
      });
      return;
    }
    setState(() => _purchasing = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: appSurfaceDark,
      body: SafeArea(
        child: _loading
            ? Center(
                child: CircularProgressIndicator(color: appCreamGold),
              )
            : Column(
                children: [
                  Align(
                    alignment: Alignment.topRight,
                    child: IconButton(
                      icon: Icon(Icons.close, color: appCreamWhite),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  Expanded(
                    child: PageView(
                      controller: _pageController,
                      children: [
                        _Screen1Value(),
                        _Screen2FreeVsPro(),
                        _Screen3PriceAnchor(
                          product: _product,
                          purchasing: _purchasing,
                          error: _error,
                          onPurchase: _purchase,
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(3, (i) {
                        return Container(
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i == 0
                                ? appCreamGold
                                : appLightGray.withOpacity(0.5),
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _Screen1Value extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            AppStrings.paywallHeadline,
            style: GoogleFonts.playfairDisplay(
              fontSize: 26,
              fontWeight: FontWeight.bold,
              color: appCreamWhite,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            AppStrings.paywallSubtext,
            style: GoogleFonts.inter(
              fontSize: 16,
              color: appLightGray,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _Screen2FreeVsPro extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 24),
          Text(
            AppStrings.paywallFreeTitle,
            style: GoogleFonts.playfairDisplay(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: appLightGray,
            ),
          ),
          const SizedBox(height: 8),
          _RowItem(check: true, text: AppStrings.paywallFreeBasic),
          _RowItem(check: false, text: AppStrings.paywallFreeNoPsych),
          _RowItem(check: false, text: AppStrings.paywallFreeNoEnhance),
          _RowItem(check: false, text: AppStrings.paywallFreeNoStrategy),
          const SizedBox(height: 24),
          Text(
            AppStrings.paywallProTitle,
            style: GoogleFonts.playfairDisplay(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: appCreamGold,
            ),
          ),
          const SizedBox(height: 8),
          _RowItem(check: true, text: AppStrings.paywallProBg),
          _RowItem(check: true, text: AppStrings.paywallProHD),
          _RowItem(check: true, text: AppStrings.paywallProReport),
          _RowItem(check: true, text: AppStrings.paywallProStyles),
          _RowItem(check: true, text: AppStrings.paywallProNoWatermark),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _RowItem extends StatelessWidget {
  final bool check;
  final String text;

  const _RowItem({required this.check, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            check ? '✓' : '✗',
            style: TextStyle(
              color: check ? appCreamGold : appLightGray,
              fontSize: 16,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: GoogleFonts.inter(
                fontSize: 14,
                color: check ? appCreamWhite : appLightGray,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Screen3PriceAnchor extends StatelessWidget {
  final ProductDetails? product;
  final bool purchasing;
  final String? error;
  final VoidCallback onPurchase;

  const _Screen3PriceAnchor({
    this.product,
    required this.purchasing,
    this.error,
    required this.onPurchase,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            AppStrings.paywallAnchorLine,
            style: GoogleFonts.inter(
              fontSize: 14,
              color: appLightGray,
              decoration: TextDecoration.lineThrough,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            AppStrings.paywallOurPrice,
            style: GoogleFonts.playfairDisplay(
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: appCreamGold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            AppStrings.paywallPriceNote,
            style: GoogleFonts.inter(fontSize: 13, color: appLightGray),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          Text(
            AppStrings.trust1,
            style: GoogleFonts.inter(fontSize: 13, color: appCreamWhite),
          ),
          const SizedBox(height: 6),
          Text(
            AppStrings.trust2,
            style: GoogleFonts.inter(fontSize: 13, color: appCreamWhite),
          ),
          const SizedBox(height: 6),
          Text(
            AppStrings.trust3,
            style: GoogleFonts.inter(fontSize: 13, color: appCreamWhite),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (product != null && !purchasing) ? onPurchase : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: appCreamGold,
                foregroundColor: Colors.black,
              ),
              child: purchasing
                  ? SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.black,
                      ),
                    )
                  : Text(
                      AppStrings.paywallCta,
                      style: GoogleFonts.inter(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            AppStrings.paywallFooter,
            style: GoogleFonts.inter(
              fontSize: 12,
              color: appLightGray,
              fontStyle: FontStyle.italic,
            ),
            textAlign: TextAlign.center,
          ),
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error!,
              style: TextStyle(color: Colors.red.shade300, fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}
