// Wait for the DOM to load
document.addEventListener('DOMContentLoaded', function() {
    // Add animated element class to key elements
    const elementsToAnimate = [
        ...document.querySelectorAll('.hero-content h1, .hero-content p, .hero-content .button'),
        ...document.querySelectorAll('.feature-card, .step, .pricing-card, .testimonial, .faq-item')
    ];

    // Add animation classes with delays
    elementsToAnimate.forEach((element, index) => {
        element.classList.add('animated-element');

        // Add delay classes for elements in hero section
        if (element.closest('.hero-content')) {
            const delay = Math.min(index, 3);
            element.classList.add(`anim-delay-${delay + 1}`);
        }
    });

    // Initialize animations on page load
    setTimeout(() => {
        initAnimations();
    }, 100);

    // Intersection Observer for scroll animations
    function initAnimations() {
        // Show hero elements immediately
        document.querySelectorAll('.hero-content .animated-element').forEach(el => {
            el.classList.add('visible');
        });

        // Intersection Observer options
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.15
        };

        // Create observer
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Add staggered delays for grouped elements
                    if (entry.target.parentElement && 
                        (entry.target.parentElement.classList.contains('features-grid') || 
                         entry.target.parentElement.classList.contains('steps') ||
                         entry.target.parentElement.classList.contains('pricing-cards') ||
                         entry.target.parentElement.classList.contains('faq-grid'))) {
                        
                        const siblings = Array.from(entry.target.parentElement.children);
                        const index = siblings.indexOf(entry.target);
                        
                        setTimeout(() => {
                            entry.target.classList.add('visible');
                        }, index * 100); // 100ms stagger delay
                    } else {
                        entry.target.classList.add('visible');
                    }
                    
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        // Observe all animated elements except hero content (already visible)
        document.querySelectorAll('.animated-element:not(.hero-content .animated-element)').forEach(element => {
            observer.observe(element);
        });
    }

    // Parallax effect for hero image
    const heroImage = document.querySelector('.hero-image img');
    if (heroImage) {
        window.addEventListener('mousemove', (e) => {
            const mouseX = e.clientX / window.innerWidth - 0.5;
            const mouseY = e.clientY / window.innerHeight - 0.5;
            
            heroImage.style.transform = `perspective(1000px) rotateY(${-mouseX * 10}deg) rotateX(${mouseY * 10}deg) translateZ(10px)`;
        });
    }
    
    // Smooth header background on scroll
    const header = document.querySelector('header');
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
        
        // Only apply additional classes on desktops (avoid mobile scroll issues)
        if (window.innerWidth > 768) {
            if (scrollTop > lastScrollTop) {
                // Scrolling down
                header.classList.add('header-hidden');
            } else {
                // Scrolling up
                header.classList.remove('header-hidden');
            }
        }
        
        lastScrollTop = scrollTop;
    });
    
    // Mobile Navigation Toggle with improved animation
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');
    const ctaButtons = document.querySelector('.cta-buttons');
    
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            this.classList.toggle('active');
            
            // Create mobile menu if it doesn't exist
            let mobileMenu = document.querySelector('.mobile-menu');
            
            if (!mobileMenu) {
                mobileMenu = document.createElement('div');
                mobileMenu.className = 'mobile-menu';
                
                // Clone navigation links and CTA buttons
                const navClone = navLinks.cloneNode(true);
                const ctaClone = ctaButtons.cloneNode(true);
                
                // Add animation classes to mobile menu items
                Array.from(navClone.children).forEach((item, index) => {
                    item.classList.add('mobile-item');
                    item.style.transitionDelay = `${index * 0.05 + 0.1}s`;
                });
                
                Array.from(ctaClone.children).forEach((item, index) => {
                    item.classList.add('mobile-item');
                    item.style.transitionDelay = `${(index + navClone.children.length) * 0.05 + 0.1}s`;
                });
                
                mobileMenu.appendChild(navClone);
                mobileMenu.appendChild(ctaClone);
                
                document.body.appendChild(mobileMenu);
                
                // Add smooth scroll functionality to mobile menu links
                mobileMenu.querySelectorAll('a[href^="#"]').forEach(anchor => {
                    anchor.addEventListener('click', function(e) {
                        if (this.getAttribute('href') !== '#') {
                            e.preventDefault();
                            
                            mobileMenu.classList.remove('active');
                            hamburger.classList.remove('active');
                            document.body.classList.remove('no-scroll');
                            
                            const targetId = this.getAttribute('href');
                            const targetElement = document.querySelector(targetId);
                            
                            if (targetElement) {
                                window.scrollTo({
                                    top: targetElement.offsetTop - 80,
                                    behavior: 'smooth'
                                });
                            }
                        }
                    });
                });
            }
            
            // Add a slight delay before showing the mobile menu for smoother animation
            if (!mobileMenu.classList.contains('active')) {
                setTimeout(() => {
                    mobileMenu.classList.add('active');
                    document.body.classList.add('no-scroll');
                }, 50);
            } else {
                mobileMenu.classList.remove('active');
                document.body.classList.remove('no-scroll');
            }
        });
    }
    
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            if (this.getAttribute('href') !== '#') {
                e.preventDefault();
                
                // Close mobile menu if open
                const mobileMenu = document.querySelector('.mobile-menu');
                if (mobileMenu && mobileMenu.classList.contains('active')) {
                    mobileMenu.classList.remove('active');
                    hamburger.classList.remove('active');
                    document.body.classList.remove('no-scroll');
                }
                
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);
                
                if (targetElement) {
                    window.scrollTo({
                        top: targetElement.offsetTop - 80,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
    
    // Testimonial slider with improved functionality
    const testimonials = document.querySelectorAll('.testimonial');
    const dots = document.querySelectorAll('.dot');
    
    if (testimonials.length > 0 && dots.length > 0) {
        let currentTestimonial = 0;
        let isAnimating = false;
        
        // Initialize the slider
        testimonials.forEach((testimonial, index) => {
            testimonial.style.position = 'absolute';
            testimonial.style.top = '0';
            testimonial.style.left = '0';
            testimonial.style.width = '100%';
            testimonial.style.opacity = '0';
            testimonial.style.transform = 'translateY(20px)';
            testimonial.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            testimonial.style.pointerEvents = 'none';
            
            if (index === 0) {
                testimonial.style.opacity = '1';
                testimonial.style.transform = 'translateY(0)';
                testimonial.style.pointerEvents = 'auto';
            }
        });
        
        // Add active class to first dot
        if (dots.length > 0) {
            dots[0].classList.add('active');
        }
        
        // Add click event to dots
        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                if (!isAnimating && index !== currentTestimonial) {
                    showTestimonial(index);
                }
            });
        });
        
        // Auto-rotate testimonials with pause on hover
        const testimonialSlider = document.querySelector('.testimonial-slider');
        let autoplayInterval;
        
        function startAutoplay() {
            autoplayInterval = setInterval(() => {
                if (!isAnimating) {
                    const nextIndex = (currentTestimonial + 1) % testimonials.length;
                    showTestimonial(nextIndex);
                }
            }, 6000);
        }
        
        if (testimonialSlider) {
            startAutoplay();
            
            // Pause autoplay on hover
            testimonialSlider.addEventListener('mouseenter', () => {
                clearInterval(autoplayInterval);
            });
            
            // Resume autoplay on mouse leave
            testimonialSlider.addEventListener('mouseleave', () => {
                startAutoplay();
            });
        }
        
        function showTestimonial(index) {
            if (isAnimating) return;
            isAnimating = true;
            
            // Hide current testimonial
            testimonials[currentTestimonial].style.opacity = '0';
            testimonials[currentTestimonial].style.transform = 'translateY(20px)';
            testimonials[currentTestimonial].style.pointerEvents = 'none';
            
            // Update dots
            dots[currentTestimonial].classList.remove('active');
            dots[index].classList.add('active');
            
            // Wait for animation to complete
            setTimeout(() => {
                // Show new testimonial
                testimonials[index].style.opacity = '1';
                testimonials[index].style.transform = 'translateY(0)';
                testimonials[index].style.pointerEvents = 'auto';
                
                // Update current index
                currentTestimonial = index;
                
                // Allow new animations after transition
                setTimeout(() => {
                    isAnimating = false;
                }, 500);
            }, 300);
        }
    }
    
    // Enhanced FAQ accordion functionality
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('h3');
        const answer = item.querySelector('p');
        
        if (question && answer) {
            // Set initial state for answers
            answer.style.height = '0';
            answer.style.overflow = 'hidden';
            answer.style.transition = 'height 0.3s ease, opacity 0.3s ease, transform 0.3s ease';
            answer.style.opacity = '0';
            answer.style.transform = 'translateY(-10px)';
            
            // Add + icon to questions
            if (!question.querySelector('.faq-icon')) {
                const icon = document.createElement('span');
                icon.className = 'faq-icon';
                icon.innerHTML = '+';
                question.appendChild(icon);
            }
            
            question.addEventListener('click', () => {
                const isActive = item.classList.contains('active');
                
                // Close all other FAQs
                faqItems.forEach(otherItem => {
                    if (otherItem !== item && otherItem.classList.contains('active')) {
                        otherItem.classList.remove('active');
                        const otherAnswer = otherItem.querySelector('p');
                        const otherIcon = otherItem.querySelector('.faq-icon');
                        
                        if (otherAnswer) {
                            otherAnswer.style.height = '0';
                            otherAnswer.style.opacity = '0';
                            otherAnswer.style.transform = 'translateY(-10px)';
                        }
                        
                        if (otherIcon) {
                            otherIcon.innerHTML = '+';
                            otherIcon.style.transform = 'rotate(0deg)';
                        }
                    }
                });
                
                // Toggle current FAQ
                if (!isActive) {
                    item.classList.add('active');
                    answer.style.height = answer.scrollHeight + 'px';
                    answer.style.opacity = '1';
                    answer.style.transform = 'translateY(0)';
                    
                    const icon = item.querySelector('.faq-icon');
                    if (icon) {
                        icon.innerHTML = '−';
                        icon.style.transform = 'rotate(0deg)';
                    }
                } else {
                    item.classList.remove('active');
                    answer.style.height = '0';
                    answer.style.opacity = '0';
                    answer.style.transform = 'translateY(-10px)';
                    
                    const icon = item.querySelector('.faq-icon');
                    if (icon) {
                        icon.innerHTML = '+';
                    }
                }
            });
        }
    });
    
    // Demo video play functionality with enhanced animation
    const demoVideo = document.querySelector('.demo-video');
    const playButton = document.querySelector('.play-button');
    
    if (demoVideo && playButton) {
        playButton.addEventListener('click', function() {
            // Add fade out animation to play button
            this.style.opacity = '0';
            this.style.transform = 'translate(-50%, -50%) scale(1.2)';
            
            // Replace image with embedded video after animation
            setTimeout(() => {
                const videoPlaceholder = demoVideo.querySelector('.video-placeholder');
                
                if (videoPlaceholder) {
                    // Add a fade out animation to the placeholder
                    videoPlaceholder.style.transition = 'opacity 0.3s ease';
                    videoPlaceholder.style.opacity = '0';
                    
                    // Create and insert iframe after fade out
                    setTimeout(() => {
                        const iframe = document.createElement('iframe');
                        iframe.setAttribute('src', 'https://www.youtube.com/embed/your-video-id?autoplay=1&rel=0');
                        iframe.setAttribute('frameborder', '0');
                        iframe.setAttribute('allowfullscreen', 'true');
                        iframe.style.width = '100%';
                        iframe.style.height = '100%';
                        iframe.style.position = 'absolute';
                        iframe.style.top = '0';
                        iframe.style.left = '0';
                        iframe.style.opacity = '0';
                        iframe.style.transition = 'opacity 0.3s ease';
                        
                        demoVideo.style.paddingBottom = '56.25%';
                        demoVideo.style.position = 'relative';
                        
                        // Replace the image with the iframe
                        demoVideo.innerHTML = '';
                        demoVideo.appendChild(iframe);
                        
                        // Fade in the iframe
                        setTimeout(() => {
                            iframe.style.opacity = '1';
                        }, 50);
                    }, 300);
                }
            }, 300);
        });
    }
    
    // Sticky header enhanced styles
    const styleSheet = document.styleSheets[0];
    
    styleSheet.insertRule(`
        header {
            transition: background-color 0.3s ease, transform 0.4s ease, box-shadow 0.3s ease;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        header.scrolled {
            background-color: rgba(255, 255, 255, 0.95);
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        header.header-hidden {
            transform: translateY(-100%);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .hamburger {
            transition: transform 0.3s ease;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .hamburger.active span:nth-child(1) {
            transform: translateY(8px) rotate(45deg);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .hamburger.active span:nth-child(2) {
            opacity: 0;
            transform: translateX(-10px);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .hamburger.active span:nth-child(3) {
            transform: translateY(-8px) rotate(-45deg);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            background-color: rgba(255, 255, 255, 0.98);
            backdrop-filter: saturate(180%) blur(20px);
            -webkit-backdrop-filter: saturate(180%) blur(20px);
            z-index: 999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2rem;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.4s ease, visibility 0.4s ease;
            padding: 2rem;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu.active {
            opacity: 1;
            visibility: visible;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu .nav-links {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2rem;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu .nav-links a {
            font-size: 1.4rem;
            font-weight: 600;
            color: var(--text-dark);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu .cta-buttons {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1rem;
            width: 100%;
            max-width: 250px;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-item {
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.4s ease, transform 0.4s ease;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .mobile-menu.active .mobile-item {
            opacity: 1;
            transform: translateY(0);
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .no-scroll {
            overflow: hidden;
        }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
        .faq-icon {
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            font-size: 1.5rem;
            color: var(--primary-color);
            transition: transform 0.3s ease;
        }
    `, styleSheet.cssRules.length);

    // Button hover effects
    document.querySelectorAll('.button').forEach(button => {
        button.addEventListener('mouseenter', () => {
            button.style.transform = button.classList.contains('primary-button') ? 'translateY(-3px)' : 'translateY(-2px)';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
        });
    });
    
    // Add subtle parallax effect to key sections
    window.addEventListener('scroll', () => {
        const scrollPosition = window.pageYOffset;
        
        // Parallax for hero section
        const hero = document.querySelector('.hero');
        if (hero && window.innerWidth > 768) {
            hero.style.backgroundPositionY = `${scrollPosition * 0.1}px`;
        }
        
        // Parallax for CTA section
        const cta = document.querySelector('.cta');
        if (cta) {
            const ctaTop = cta.getBoundingClientRect().top + window.pageYOffset;
            const ctaOffset = scrollPosition - ctaTop;
            
            if (ctaOffset > -window.innerHeight && ctaOffset < window.innerHeight) {
                cta.style.backgroundPositionY = `${ctaOffset * 0.05}px`;
            }
        }
    });
}); 